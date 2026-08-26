/** @module Creation and validation of mutable resolver state. */

import type { FeatureChangeRequest } from "../api/feature-change.ts";
import type { FeatureDetection } from "../api/feature-detection.ts";
import type { FeatureId } from "../api/feature.ts";
import type { FeatureRegistry } from "./feature-registry.ts";
import type { ResolutionState } from "./resolution-state.ts";

/** Creates state and records invalid or contradictory explicit requests. */
export function createResolutionState(
  registry: FeatureRegistry,
  detections: Readonly<Record<FeatureId, FeatureDetection>>,
  request: FeatureChangeRequest,
): ResolutionState {
  const features = new Map(
    registry.features.map((feature) => [feature.metadata.id, feature]),
  );
  const explicit = new Map<FeatureId, boolean>();
  const state: ResolutionState = {
    registry,
    detections,
    features,
    capabilities: new Map(
      registry.capabilities.map((capability) => [capability.id, capability]),
    ),
    explicit,
    desired: new Map(),
    touchedCapabilities: new Set(),
    issues: [],
  };
  for (const change of request.changes) {
    if (!features.has(change.featureId)) {
      state.issues.push({
        code: "unknown-requested-feature",
        featureId: change.featureId,
      });
      continue;
    }
    const earlier = explicit.get(change.featureId);
    if (earlier !== undefined && earlier !== change.enabled) {
      state.issues.push({
        code: "contradictory-feature-request",
        featureId: change.featureId,
      });
      continue;
    }
    explicit.set(change.featureId, change.enabled);
  }
  return state;
}
