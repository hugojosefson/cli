/** @module Selects drift repairs after ordinary feature resolution. */

import type { FeatureDetection } from "../api/feature-detection.ts";
import type { FeatureId } from "../api/feature.ts";
import type {
  RepairSelection,
  ResolvedFeatureChange,
} from "../api/feature-change.ts";

/** Returns selected drifted features in stable feature-ID order. */
export function repairFeatureChanges(
  detections: ReadonlyMap<FeatureId, FeatureDetection>,
  repair: RepairSelection | undefined,
): readonly ResolvedFeatureChange[] {
  if (!repair) return [];
  const selected = repair.kind === "all-drifted"
    ? [...detections.keys()]
    : repair.featureIds;
  return [...new Set(selected)].sort().filter((featureId) =>
    detections.get(featureId)?.state === "drifted"
  ).map((featureId) => ({
    featureId,
    enabled: true,
    reason: { kind: "repair" },
  }));
}
