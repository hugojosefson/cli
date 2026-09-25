/** @module Local-only selection and detection for overwrite. */
import type { FeatureDetection } from "../api/feature-detection.ts";
import type { FeatureChangeRequest } from "../api/feature-change.ts";
import type { DetectionContext } from "../api/repository-context.ts";
import type { FeatureRegistry } from "../features/feature-registry.ts";
import { resolveFeatureChanges } from "../features/resolve-feature-changes.ts";
import { overwriteArtifacts } from "./overwrite-artifacts.ts";

export async function overwriteDetections(
  context: DetectionContext,
  registry: FeatureRegistry,
): Promise<Map<string, FeatureDetection>> {
  return new Map(
    await Promise.all(
      registry.features.map(async (feature) =>
        [feature.metadata.id, await feature.detect(context)] as const
      ),
    ),
  );
}

export function overwriteSelection(
  registry: FeatureRegistry,
  detections: ReadonlyMap<string, FeatureDetection>,
  request: FeatureChangeRequest,
) {
  if (request.repair) {
    throw new Error("`--overwrite` and `--repair` are mutually exclusive.");
  }
  if (
    !request.applyDefaults && request.presets.length === 0 &&
    !request.changes.some((change) => change.enabled)
  ) {
    throw new Error(
      "`--overwrite` needs a positive feature flag, a preset, or `--defaults`.",
    );
  }
  const resolution = resolveFeatureChanges(
    registry,
    Object.fromEntries(detections),
    request,
  );
  if (resolution.issues.length) {
    throw new Error(
      `Overwrite selection failed: ${
        resolution.issues.map((issue) =>
          `${issue.code}: ${
            issue.featureId ?? issue.capabilityId ?? issue.relatedId ?? ""
          }`
        ).join("\n")
      }`,
    );
  }
  for (const change of resolution.changes) {
    if (overwriteArtifacts(change.featureId)) continue;
    const state = detections.get(change.featureId)?.state;
    if (state === (change.enabled ? "enabled" : "disabled")) continue;
    throw new Error(
      `--overwrite changes local files only. Configure ${change.featureId} without --overwrite first.`,
    );
  }
  return resolution.changes;
}
