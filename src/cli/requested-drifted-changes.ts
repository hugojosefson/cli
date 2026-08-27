/** @module Explicit enable requests that must reach drift safety checks. */

import type { FeatureChangeRequest } from "../api/feature-change.ts";
import type { FeatureDetection } from "../api/feature-detection.ts";
import type { FeatureId } from "../api/feature.ts";

/** Restores explicit enables omitted because drifted features count as present. */
export function requestedDriftedChanges(
  detections: ReadonlyMap<FeatureId, FeatureDetection>,
  request: FeatureChangeRequest,
) {
  if (request.repair) {
    return [];
  }
  return request.changes.filter((change) =>
    change.enabled && detections.get(change.featureId)?.state === "drifted"
  ).map((change) => ({
    featureId: change.featureId,
    enabled: true,
    reason: { kind: "explicit-request" as const },
  }));
}
