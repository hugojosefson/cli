/** @module Read-only previews of the exact plans selected by feature repair. */
import type { FeatureDetection } from "../api/feature-detection.ts";
import type { OperationContext } from "../api/repository-context.ts";
import type { ChangePlan } from "../api/change-plan.ts";
import { resolveFeatureChanges } from "../features/resolve-feature-changes.ts";
import { repairFeatureChanges } from "./repair-feature-changes.ts";
import type { FeatureRegistry } from "../features/feature-registry.ts";
import { describePlannedChange } from "./describe-planned-change.ts";
import { reconcileFeaturePlans } from "./reconcile-feature-plans.ts";
import { repairCompletionDescription } from "./repair-completion-description.ts";

/** Describes unresolved states; matching enabled and disabled states need no guidance. */
export function repairStateDescription(
  detection?: FeatureDetection,
): string | undefined {
  if (detection?.state === "enabled" || detection?.state === "disabled") {
    return undefined;
  }
  if (detection?.state === "ambiguous") {
    const resolutions = [
      ...new Set(
        detection.issues.map((issue) =>
          `${issue.subject.identifier}: ${issue.resolution}`
        ),
      ),
    ];
    return resolutions.join("\n") || undefined;
  }
  return detection
    ? undefined
    : "Expected a feature detection result. Found no result.";
}

/** Calls only reader/check/planner contracts: no prompts, preflight or application. */
export async function featureRepairPreviews(
  base: OperationContext,
  registry: FeatureRegistry,
): Promise<ReadonlyMap<string, string>> {
  const descriptions = new Map<string, string>();
  for (const feature of registry.features) {
    const id = feature.metadata.id;
    const detection = base.detections.get(id);
    if (detection?.state !== "drifted") {
      const description = repairStateDescription(detection);
      if (description) descriptions.set(id, description);
      continue;
    }
    const request = {
      changes: [{ featureId: id, enabled: true }],
      presets: [],
      defaults: [],
      applyDefaults: false,
      repair: { kind: "features" as const, featureIds: [id] },
    };
    const resolution = resolveFeatureChanges(
      registry,
      Object.fromEntries(base.detections),
      request,
    );
    if (resolution.issues.length) {
      descriptions.set(
        id,
        "Repair is blocked by feature dependencies or conflicts. " +
          resolution.issues.map((issue) =>
            [issue.code, issue.featureId, issue.capabilityId, issue.relatedId]
              .filter(Boolean).join(": ")
          ).join("; ") +
          ". Resolve the reported feature states before retrying.",
      );
      continue;
    }
    const context: OperationContext = {
      ...base,
      requestedChanges: request.changes,
      resolvedChanges: [
        ...resolution.changes,
        ...repairFeatureChanges(base.detections, request.repair),
      ],
      repair: request.repair,
    };
    try {
      const initialPlans: ChangePlan[] = [];
      const blockers: string[] = [];
      const noOps: string[] = [];
      for (const change of context.resolvedChanges) {
        const selected = registry.features.find((item) =>
          item.metadata.id === change.featureId
        )!;
        const check =
          await (change.enabled ? selected.checkEnable : selected.checkDisable)(
            context,
          );
        if (check.result === "blocked") {
          blockers.push(
            ...check.blockers.map((blocker) =>
              `${change.featureId}: ${blocker.message} ${blocker.resolution}`
            ),
          );
        } else if (check.result === "no-op") {
          noOps.push(check.reason);
        } else {
          initialPlans.push(
            await (change.enabled ? selected.planEnable : selected.planDisable)(
              context,
              check,
            ),
          );
        }
      }
      if (blockers.length) {
        descriptions.set(id, `Repair is blocked. ${blockers.join(" ")}`);
        continue;
      }
      const plans = await reconcileFeaturePlans(
        context,
        initialPlans,
        registry,
      );
      const changes = plans.flatMap((plan) => plan.changes);
      if (!changes.length) {
        descriptions.set(
          id,
          `Repair makes no changes. ${
            noOps.join(" ")
          } Resolve the reported drift manually.`,
        );
        continue;
      }
      const actions = await Promise.all(
        changes.map((change) =>
          describePlannedChange(change, context.files, context.github)
        ),
      );
      descriptions.set(
        id,
        [
          ...new Set([
            // Explicit selection can enable missing dependencies; bare repair cannot.
            resolution.changes.length ? `--repair --${id}:` : "--repair:",
            ...actions,
            ...await repairCompletionDescription(context, plans),
            ...plans.flatMap((plan) =>
              plan.warnings.map((warning) =>
                `${warning.message}${
                  warning.resolution ? ` ${warning.resolution}` : ""
                }`
              )
            ),
          ].flatMap((detail) => detail.split("\n"))),
        ].join("\n"),
      );
    } catch {
      // Raw planner/transport exceptions can contain file content or credentials.
      descriptions.set(
        id,
        "Repair preview is unavailable. Check access to the reported files and GitHub resources, resolve their configuration, and rerun feature inspection.",
      );
    }
  }
  return descriptions;
}
