/** @module Repository detection, resolution, planning, and local application. */
import type { OutputColors } from "./terminal-colors.ts";
import { formatTable } from "./format-table.ts";

import type { ChangePlan, PlannedValidation } from "../api/change-plan.ts";
import type { OperationContext } from "../api/repository-context.ts";
import { builtInFeatureRegistry } from "../features/built-in-feature-registry.ts";
import { reconcileGitIgnorePlans } from "../features/git-ignore-feature.ts";
import { licenseCatalog } from "../features/license-catalog.ts";
import type { FeatureRegistry } from "../features/feature-registry.ts";
import { resolveFeatureChanges } from "../features/resolve-feature-changes.ts";
import {
  applyLocalChangePlan,
  preflightLocalChangePlan,
} from "../operations/local-change-plan.ts";
import { LocalFileReader } from "../repository/local-file-reader.ts";
import { LocalGitReader } from "../repository/local-git-reader.ts";
import { LocalGithubIdentityReader } from "../repository/local-github-identity-reader.ts";
import type { GithubIdentityReader } from "../api/repository-context.ts";
import type { GithubWriter } from "../api/repository-context.ts";
import { LocalGithubClient } from "../repository/local-github-client.ts";
import {
  applyGithubChangePlans,
  preflightGithubChangePlan,
} from "../operations/github-change-plan.ts";
import { formatFeatureResult, formatFeatureStatus } from "./format-features.ts";
import { FeatureCommitSession } from "./git-feature-commit.ts";
import { CommandFailure } from "./command-failure.ts";
import { runFinalProjectTask } from "./final-project-task.ts";
import type { FeaturesArguments } from "./parse-features.ts";
import {
  type FeatureAction,
  featureActions,
  selectedFeatureActionsToRequest,
} from "./feature-actions.ts";
import { promptFeatureActions } from "./prompt-feature-actions.ts";
import { repairFeatureChanges } from "./repair-feature-changes.ts";
import { requireConfirmation } from "./require-confirmation.ts";
import { requestedDriftedChanges } from "./requested-drifted-changes.ts";
import { workflowCliChanges } from "./workflow-cli-changes.ts";
import {
  evaluateMainProtection,
  evaluateReleaseTagProtection,
} from "../release/effective-protection.ts";
import {
  type AttributionPrompt,
  resolveLicenseAttribution,
} from "./license-attribution.ts";
export type FeatureSelector = (
  actions: readonly FeatureAction[],
) => readonly string[];

export interface FeatureOperationServices {
  readonly colors?: OutputColors;
  /** Replaces project task execution for isolated operation tests. */
  readonly runFinalTask?: typeof runFinalProjectTask;
  readonly promptAttribution?: AttributionPrompt;
  readonly githubIdentity?: GithubIdentityReader;
  readonly github?: GithubWriter;
}

/** Runs the built-in repository feature operation at one local root. */
export async function runFeatures(
  root: URL,
  args: FeaturesArguments,
  selectActions: FeatureSelector = promptFeatureActions,
  colors: OutputColors = {},
): Promise<string> {
  return await runFeatureOperation(
    root,
    args,
    builtInFeatureRegistry,
    selectActions,
    { colors },
  );
}

/** Runs one repository feature operation using the supplied registry. */
export async function runFeatureOperation(
  root: URL,
  args: FeaturesArguments,
  registry: FeatureRegistry,
  selectActions: FeatureSelector = promptFeatureActions,
  services: FeatureOperationServices = {},
): Promise<string> {
  const files = new LocalFileReader(root);
  const git = new LocalGitReader(root);
  const githubIdentity = services.githubIdentity ??
    new LocalGithubIdentityReader(root);
  const github = services.github ?? new LocalGithubClient(root);
  try {
    // All feature operations inspect Git state before planning file commits.
    // Report this prerequisite before starting optional GitHub reads.
    await git.isRepository();
    const detections = await detect(root, files, git, github, registry);
    if (args.kind === "status") {
      return formatFeatureStatus(registry, detections, services.colors?.stdout);
    }
    const request = args.kind === "interactive"
      ? selectedFeatureActionsToRequest(
        selectActions(featureActions(registry, detections)),
      )
      : args.request;
    if (
      request.changes.length === 0 && request.presets.length === 0 &&
      !request.applyDefaults && !request.repair
    ) {
      return formatFeatureStatus(registry, detections, services.colors?.stdout);
    }
    const resolution = resolveFeatureChanges(
      registry,
      Object.fromEntries(detections),
      request,
    );
    if (resolution.issues.length) {
      throw new Error(
        "resolution failed:\n" + formatTable(
          ["Issue", "Feature or capability", "Related"],
          resolution.issues.map((
            issue,
          ) => [
            issue.code,
            issue.featureId ?? issue.capabilityId ?? "",
            issue.relatedId ?? "",
          ]),
          undefined,
          { color: services.colors?.stderr, columns: ["red", "cyan"] },
        ),
      );
    }
    const changes = [
      ...resolution.changes,
      ...requestedDriftedChanges(detections, request),
      ...repairFeatureChanges(detections, request.repair),
    ];
    if ("workflowCli" in args && args.workflowCli !== undefined) {
      changes.push(...workflowCliChanges(request, registry, changes));
    }
    const baseContext = {
      repositoryRoot: root,
      files,
      git,
      githubIdentity,
      github,
      detections,
      requestedChanges: request.changes,
      resolvedChanges: changes,
      repair: request.repair?.kind === "features" && "workflowCli" in args &&
          args.workflowCli !== undefined
        ? {
          kind: "features" as const,
          featureIds: [
            ...new Set([
              ...request.repair.featureIds,
              ...changes.filter((change) =>
                change.enabled &&
                (change.featureId === "github-ci" ||
                  change.featureId.startsWith("github-release-publish-"))
              ).map((change) => change.featureId),
            ]),
          ],
        }
        : request.repair,
    };
    const licenseOptions = changes.some((change) =>
        change.enabled &&
        detections.get(change.featureId)?.state === "disabled" &&
        licenseCatalog.find((provider) => provider.id === change.featureId)
          ?.definition.placeholders.some(({ kind }) =>
            kind === "year" || kind === "holder"
          )
      )
      ? await resolveLicenseAttribution(baseContext, services.promptAttribution)
      : {};
    const context: OperationContext = {
      ...baseContext,
      options: {
        confirmation: args.confirmation,
        ...licenseOptions,
        ...("workflowCli" in args && args.workflowCli !== undefined
          ? { workflowCli: args.workflowCli }
          : {}),
      },
    };
    let plans = await plansFor(
      context,
      changes,
      registry,
      services.colors?.stderr,
    );
    if (
      registry.features.some((feature) => feature.metadata.id === "git-ignore")
    ) {
      plans = await reconcileGitIgnorePlans(context, plans);
    }
    requireConfirmation(plans, args.confirmation);
    rejectUnsupportedValidations(plans);
    await Promise.all(
      plans.map((plan) => preflightLocalChangePlan(root, localPlan(plan))),
    );
    await Promise.all(
      plans.map((plan) => preflightGithubChangePlan(github, plan)),
    );
    const beforeGit = await git.isRepository();
    const initializedGit = plans.some((plan) =>
      plan.changes.some((change) => change.kind === "git-init")
    );
    const commits = await FeatureCommitSession.prepare(root, plans);
    const remoteChanges = githubChangeNames(plans);
    await applyGithubChangePlans(github, plans);
    try {
      await commits?.initialize();
      for (const plan of plans) {
        await applyLocalChangePlan(root, localPlan(plan));
        await commits?.initialize();
        await commits?.capture(plan);
      }
    } catch (error) {
      if (remoteChanges.length) {
        throw new Error(
          `Local changes failed after GitHub changes.\n${
            formatTable(
              ["Changed GitHub resource"],
              remoteChanges.map((name) => [name]),
              undefined,
              { color: services.colors?.stderr, columns: ["yellow"] },
            )
          }\nStart the same operation again.`,
          { cause: error },
        );
      }
      throw error;
    }
    const finalTask = await (services.runFinalTask ?? runFinalProjectTask)(
      root,
      plans,
    );
    await validate(
      root,
      files,
      git,
      github,
      registry,
      plans.flatMap((plan) => plan.validations),
    );
    const committed = await commits?.finish() ?? false;
    const githubChanged = plans.some((plan) =>
      plan.changes.some((change) =>
        change.kind === "upsert-github-resource" ||
        change.kind === "delete-github-resource" ||
        change.kind === "github-ruleset-transition"
      )
    );
    return formatFeatureResult(
      formatFeatureStatus(
        registry,
        await detect(root, files, git, github, registry),
        services.colors?.stdout,
      ),
      {
        committed,
        finalTask,
        initializedGit: !beforeGit && initializedGit,
        localChanged: plans.some((plan) => localPlan(plan).changes.length > 0),
        githubChanged,
      },
      services.colors?.stdout,
    );
  } catch (error) {
    if (
      error instanceof Error && github instanceof LocalGithubClient &&
      github.diagnostics.length
    ) {
      if (error instanceof CommandFailure) {
        error.message += `\n${github.diagnostics.join("\n")}`;
        throw error;
      }
      throw new Error(`${error.message}\n${github.diagnostics.join("\n")}`, {
        cause: error,
      });
    }
    throw error;
  }
}

async function detect(
  root: URL,
  files: LocalFileReader,
  git: LocalGitReader,
  github: GithubWriter,
  registry: FeatureRegistry,
) {
  const context = { repositoryRoot: root, files, git, github };
  return new Map(
    await Promise.all(
      registry.features.map(async (feature) =>
        [feature.metadata.id, await feature.detect(context)] as const
      ),
    ),
  );
}

async function plansFor(
  context: OperationContext,
  changes: OperationContext["resolvedChanges"],
  registry: FeatureRegistry,
  color = false,
): Promise<readonly ChangePlan[]> {
  const plans: ChangePlan[] = [];
  for (const change of changes) {
    const feature = registry.features.find((item) =>
      item.metadata.id === change.featureId
    )!;
    const check =
      await (change.enabled ? feature.checkEnable : feature.checkDisable)(
        context,
      );
    if (check.result === "blocked") {
      throw new Error(
        "blocked:\n" + formatTable(
          ["Feature", "Problem", "Next step"],
          check.blockers.map((
            blocker,
          ) => [change.featureId, blocker.message, blocker.resolution]),
          [32, 48, 48],
          { color, columns: ["cyan", "red"] },
        ),
      );
    }
    if (check.result === "allowed") {
      plans.push(
        await (change.enabled ? feature.planEnable : feature.planDisable)(
          context,
          check,
        ),
      );
    }
  }
  return plans;
}

function rejectUnsupportedValidations(plans: readonly ChangePlan[]): void {
  const validation = plans.flatMap((plan) => plan.validations).find((item) =>
    item.kind !== "feature-redetection" &&
    item.kind !== "github-main-protection" &&
    item.kind !== "github-tag-protection"
  );
  if (validation) throw new Error(`unsupported validation: ${validation.kind}`);
}

async function validate(
  root: URL,
  files: LocalFileReader,
  git: LocalGitReader,
  github: GithubWriter,
  registry: FeatureRegistry,
  validations: readonly PlannedValidation[],
): Promise<void> {
  const detections = await detect(root, files, git, github, registry);
  for (const validation of validations) {
    if (
      validation.kind === "feature-redetection" &&
      detections.get(validation.featureId)?.state !== validation.expected
    ) {
      const detection = detections.get(validation.featureId);
      const details =
        detection && "issues" in detection && detection.issues.length
          ? detection.issues.map((item) => item.observation)
          : detection?.evidence.map((item) => item.observation) ?? [];
      throw new Error(
        "Feature validation failed.\n" + formatTable(
          ["Feature", "Expected", "Observed", "Details"],
          [[
            validation.featureId,
            validation.expected,
            detection?.state ?? "unknown",
            [...new Set(details)].join("\n"),
          ]],
        ),
      );
    }
    if (
      validation.kind === "github-main-protection" ||
      validation.kind === "github-tag-protection"
    ) {
      const repository = await github.repository();
      const protection = await github.protection?.();
      if (!repository?.defaultBranch || !protection) {
        throw new Error("validation failed: GitHub protection is unavailable");
      }
      const result = validation.kind === "github-main-protection"
        ? evaluateMainProtection(protection, repository.defaultBranch)
        : evaluateReleaseTagProtection(
          protection,
          repository.defaultBranch,
          validation.tag,
        );
      if (result.kind !== "compatible") {
        throw new Error(`validation failed: ${result.reasons[0]}`);
      }
    }
  }
}

function localPlan(plan: ChangePlan): ChangePlan {
  return {
    ...plan,
    preconditions: plan.preconditions.filter((item) =>
      item.kind !== "github-resource-state" &&
      item.kind !== "github-remote-file"
    ),
    changes: plan.changes.filter((item) =>
      item.kind !== "upsert-github-resource" &&
      item.kind !== "delete-github-resource" &&
      item.kind !== "github-ruleset-transition" && item.kind !== "app-setup"
    ),
  };
}

function githubChangeNames(plans: readonly ChangePlan[]): readonly string[] {
  return plans.flatMap((plan) => plan.changes).flatMap((change) => {
    if (
      change.kind === "upsert-github-resource" ||
      change.kind === "delete-github-resource" || change.kind === "app-setup"
    ) return [change.name];
    if (change.kind === "github-ruleset-transition") {
      return [...new Set(change.steps.map((step) => step.change.name))];
    }
    return [];
  });
}
