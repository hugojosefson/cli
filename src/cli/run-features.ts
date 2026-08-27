/** @module Repository detection, resolution, planning, and local application. */

import type { ChangePlan, PlannedValidation } from "../api/change-plan.ts";
import type { OperationContext } from "../api/repository-context.ts";
import { builtInFeatureRegistry } from "../features/built-in-feature-registry.ts";
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
import { formatFeatureResult, formatFeatureStatus } from "./format-features.ts";
import {
  featureCommitPlan,
  plannedCommitPaths,
  requireGitIdentity,
} from "./git-feature-commit.ts";
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
import {
  type AttributionPrompt,
  resolveLicenseAttribution,
} from "./license-attribution.ts";
export type FeatureSelector = (
  actions: readonly FeatureAction[],
) => readonly string[];

export interface FeatureOperationServices {
  readonly promptAttribution?: AttributionPrompt;
  readonly githubIdentity?: GithubIdentityReader;
}

/** Runs the built-in repository feature operation at one local root. */
export async function runFeatures(
  root: URL,
  args: FeaturesArguments,
  selectActions: FeatureSelector = promptFeatureActions,
): Promise<string> {
  return await runFeatureOperation(
    root,
    args,
    builtInFeatureRegistry,
    selectActions,
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
    new LocalGithubIdentityReader();
  const detections = await detect(root, files, git, registry);
  if (args.kind === "status") {
    return formatFeatureStatus(registry, detections);
  }
  const request = args.kind === "interactive"
    ? selectedFeatureActionsToRequest(
      selectActions(featureActions(registry, detections)),
    )
    : args.request;
  if (request.changes.length === 0 && !request.repair) {
    return formatFeatureStatus(registry, detections);
  }
  const resolution = resolveFeatureChanges(
    registry,
    Object.fromEntries(detections),
    request,
  );
  if (resolution.issues.length) {
    throw new Error(`resolution failed: ${resolution.issues[0].code}`);
  }
  const changes = [
    ...resolution.changes,
    ...requestedDriftedChanges(detections, request),
    ...repairFeatureChanges(detections, request.repair),
  ];
  const baseContext = {
    repositoryRoot: root,
    files,
    git,
    githubIdentity,
    detections,
    requestedChanges: request.changes,
    resolvedChanges: changes,
    repair: request.repair,
  };
  const licenseOptions =
    changes.some((change) =>
        change.featureId.startsWith("license-") &&
        change.enabled && detections.get(change.featureId)?.state === "disabled"
      )
      ? await resolveLicenseAttribution(baseContext, services.promptAttribution)
      : {};
  const context: OperationContext = {
    ...baseContext,
    options: { confirmation: args.confirmation, ...licenseOptions },
  };
  const plans = await plansFor(context, changes, registry);
  requireConfirmation(plans, args.confirmation);
  rejectUnsupportedValidations(plans);
  await Promise.all(plans.map((plan) => preflightLocalChangePlan(root, plan)));
  const beforeGit = await git.isRepository();
  const paths = plannedCommitPaths(plans);
  const initializedGit = plans.some((plan) =>
    plan.changes.some((change) => change.kind === "git-init")
  );
  const commit = beforeGit && paths.length > 0
    ? featureCommitPlan(paths)
    : undefined;
  if (commit) {
    await requireGitIdentity(root);
    await preflightLocalChangePlan(root, commit);
  }
  for (const plan of plans) await applyLocalChangePlan(root, plan);
  await validate(
    root,
    files,
    git,
    registry,
    plans.flatMap((plan) => plan.validations),
  );
  const committed = commit !== undefined;
  if (commit) await applyLocalChangePlan(root, commit);
  return formatFeatureResult(
    formatFeatureStatus(registry, await detect(root, files, git, registry)),
    committed,
    !beforeGit && initializedGit,
  );
}

async function detect(
  root: URL,
  files: LocalFileReader,
  git: LocalGitReader,
  registry: FeatureRegistry,
) {
  const context = { repositoryRoot: root, files, git };
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
      throw new Error(`blocked: ${check.blockers[0].message}`);
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
    item.kind !== "feature-redetection"
  );
  if (validation) throw new Error(`unsupported validation: ${validation.kind}`);
}

async function validate(
  root: URL,
  files: LocalFileReader,
  git: LocalGitReader,
  registry: FeatureRegistry,
  validations: readonly PlannedValidation[],
): Promise<void> {
  const detections = await detect(root, files, git, registry);
  for (const validation of validations) {
    if (
      validation.kind === "feature-redetection" &&
      detections.get(validation.featureId)?.state !== validation.expected
    ) {
      throw new Error(`validation failed: ${validation.featureId}`);
    }
  }
}
