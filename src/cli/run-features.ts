/** @module Repository detection, resolution, planning, and local application. */

import type { ChangePlan, PlannedValidation } from "../api/change-plan.ts";
import type { OperationContext } from "../api/repository-context.ts";
import { builtInFeatureRegistry } from "../features/built-in-feature-registry.ts";
import { resolveFeatureChanges } from "../features/resolve-feature-changes.ts";
import {
  applyLocalChangePlan,
  preflightLocalChangePlan,
} from "../operations/local-change-plan.ts";
import { LocalFileReader } from "../repository/local-file-reader.ts";
import { LocalGitReader } from "../repository/local-git-reader.ts";
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
export type FeatureSelector = (
  actions: readonly FeatureAction[],
) => readonly string[];

/** Runs the built-in repository feature operation at one local root. */
export async function runFeatures(
  root: URL,
  args: FeaturesArguments,
  selectActions: FeatureSelector = promptFeatureActions,
): Promise<string> {
  const files = new LocalFileReader(root);
  const git = new LocalGitReader(root);
  const beforeGit = await git.isRepository();
  const detections = await detect(root, files, git);
  if (args.kind === "status") {
    return formatFeatureStatus(builtInFeatureRegistry, detections);
  }
  const request = args.kind === "interactive"
    ? selectedFeatureActionsToRequest(
      selectActions(featureActions(builtInFeatureRegistry, detections)),
    )
    : args.request;
  if (request.changes.length === 0 && !request.repair) {
    return formatFeatureStatus(builtInFeatureRegistry, detections);
  }
  const resolution = resolveFeatureChanges(
    builtInFeatureRegistry,
    Object.fromEntries(detections),
    request,
  );
  if (resolution.issues.length) {
    throw new Error(`resolution failed: ${resolution.issues[0].code}`);
  }
  const changes = [
    ...resolution.changes,
    ...repairFeatureChanges(detections, request.repair),
  ];
  const context: OperationContext = {
    repositoryRoot: root,
    files,
    git,
    detections,
    requestedChanges: request.changes,
    resolvedChanges: changes,
    repair: request.repair,
    options: {},
  };
  const plans = await plansFor(context, changes);
  rejectUnsupportedValidations(plans);
  await Promise.all(plans.map((plan) => preflightLocalChangePlan(root, plan)));
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
  await validate(root, files, git, plans.flatMap((plan) => plan.validations));
  const committed = commit !== undefined;
  if (commit) await applyLocalChangePlan(root, commit);
  return formatFeatureResult(
    formatFeatureStatus(builtInFeatureRegistry, await detect(root, files, git)),
    committed,
    !beforeGit && initializedGit,
  );
}

async function detect(root: URL, files: LocalFileReader, git: LocalGitReader) {
  const context = { repositoryRoot: root, files, git };
  return new Map(
    await Promise.all(
      builtInFeatureRegistry.features.map(async (feature) =>
        [feature.metadata.id, await feature.detect(context)] as const
      ),
    ),
  );
}

async function plansFor(
  context: OperationContext,
  changes: OperationContext["resolvedChanges"],
): Promise<readonly ChangePlan[]> {
  const plans: ChangePlan[] = [];
  for (const change of changes) {
    const feature = builtInFeatureRegistry.features.find((item) =>
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
  validations: readonly PlannedValidation[],
): Promise<void> {
  const detections = await detect(root, files, git);
  for (const validation of validations) {
    if (
      validation.kind === "feature-redetection" &&
      detections.get(validation.featureId)?.state !== validation.expected
    ) {
      throw new Error(`validation failed: ${validation.featureId}`);
    }
  }
}
