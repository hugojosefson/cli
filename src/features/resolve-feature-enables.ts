/** @module Dependency and capability closure for enabled features. */

import type { FeatureChangeRequest } from "../api/feature-change.ts";
import { selectCapabilityProvider } from "./select-capability-provider.ts";
import {
  isFeatureSelected,
  type ResolutionState,
  selectFeature,
} from "./resolution-state.ts";

/** Applies explicit defaults to resolver state. */
export function applyFeatureDefaults(
  state: ResolutionState,
  request: FeatureChangeRequest,
): void {
  if (!request.applyDefaults) {
    return;
  }
  for (const selection of request.defaults) {
    if (selection.kind === "feature") {
      if (!state.features.has(selection.featureId)) {
        state.issues.push({
          code: "unknown-default-feature",
          featureId: selection.featureId,
        });
      } else if (!state.explicit.has(selection.featureId)) {
        selectFeature(state, selection.featureId, true, { kind: "defaults" });
      }
      continue;
    }
    if (!state.capabilities.has(selection.capabilityId)) {
      state.issues.push({
        code: "unknown-default-capability",
        capabilityId: selection.capabilityId,
      });
      continue;
    }
    selectCapabilityProvider(state, selection.capabilityId, undefined, {
      kind: "defaults",
    });
  }
}

/** Resolves transitive direct dependencies and required capabilities. */
export function resolveFeatureEnables(state: ResolutionState): void {
  let selectedCount = -1;
  while (selectedCount !== state.desired.size) {
    selectedCount = state.desired.size;
    for (const [id, desired] of [...state.desired].sort(byId)) {
      if (!desired.enabled) {
        continue;
      }
      const feature = state.features.get(id);
      if (feature === undefined) {
        continue;
      }
      for (
        const dependency of [...feature.dependencies.requires].sort((a, b) =>
          a.featureId.localeCompare(b.featureId)
        )
      ) {
        if (state.explicit.get(dependency.featureId) === false) {
          state.issues.push({
            code: "explicitly-disabled-dependency",
            featureId: id,
            relatedId: dependency.featureId,
          });
        } else if (
          !isFeatureSelected(state, dependency.featureId) ||
          state.overwrite && !state.desired.has(dependency.featureId) &&
            state.detections[dependency.featureId]?.state !== "enabled"
        ) {
          selectFeature(state, dependency.featureId, true, {
            kind: "direct-feature-dependency",
            requiredBy: id,
            reason: dependency.reason,
          });
        }
      }
      for (const requirement of feature.capabilities.requires) {
        selectCapabilityProvider(
          state,
          requirement.capabilityId,
          id,
        );
      }
    }
  }
}

function byId(
  left: readonly [string, unknown],
  right: readonly [string, unknown],
): number {
  return left[0].localeCompare(right[0]);
}
