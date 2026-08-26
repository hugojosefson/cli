/** @module Dependency and capability selection for a valid registry. */

import type { FeatureChangeRequest } from "../api/feature-change.ts";
import type { FeatureDetection } from "../api/feature-detection.ts";
import type { FeatureId } from "../api/feature.ts";
import {
  checkExclusiveCapabilities,
  checkFeatureDisables,
  resolveExplicitExclusiveProviders,
} from "./check-feature-resolution.ts";
import { createResolutionState } from "./create-resolution-state.ts";
import type { FeatureChangeResolution } from "./feature-resolution.ts";
import type { FeatureRegistry } from "./feature-registry.ts";
import { orderFeatureChanges } from "./order-feature-changes.ts";
import {
  applyFeatureDefaults,
  resolveFeatureEnables,
} from "./resolve-feature-enables.ts";
import { changedFeatures, selectFeature } from "./resolution-state.ts";
import { sortFeatureResolutionIssues } from "./sort-feature-resolution-issues.ts";

/** Resolves requests after the caller has validated the registry. */
export function resolveRegistryChanges(
  registry: FeatureRegistry,
  detections: Readonly<Record<FeatureId, FeatureDetection>>,
  request: FeatureChangeRequest,
): FeatureChangeResolution {
  const state = createResolutionState(registry, detections, request);
  for (const [featureId, enabled] of state.explicit) {
    selectFeature(state, featureId, enabled, { kind: "explicit-request" });
  }
  applyFeatureDefaults(state, request);
  resolveFeatureEnables(state);
  resolveExplicitExclusiveProviders(state);
  checkExclusiveCapabilities(state);
  checkFeatureDisables(state);
  const issues = sortFeatureResolutionIssues(state.issues);
  if (issues.length > 0) {
    return { changes: [], issues };
  }
  return {
    changes: orderFeatureChanges(registry, changedFeatures(state)),
    issues: [],
  };
}
