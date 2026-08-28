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
  applyPresets(state, request);
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

/** Applies non-explicit preset targets before normal dependency resolution. */
function applyPresets(
  state: ReturnType<typeof createResolutionState>,
  request: FeatureChangeRequest,
): void {
  const presets = new Map((state.registry.presets ?? []).map((preset) => [
    preset.id,
    preset,
  ]));
  const targets = new Map<
    string,
    Array<{
      readonly enabled: boolean;
      readonly presetId: string;
    }>
  >();
  for (const presetId of request.presets) {
    const preset = presets.get(presetId);
    if (!preset) {
      state.issues.push({
        code: "unknown-requested-preset",
        relatedId: presetId,
      });
      continue;
    }
    for (const target of preset.changes) {
      if (state.explicit.has(target.featureId)) continue;
      const selections = targets.get(target.featureId) ?? [];
      selections.push({
        enabled: target.enabled,
        presetId: preset.id,
      });
      targets.set(target.featureId, selections);
    }
  }
  for (const [featureId, selections] of targets) {
    const strongest = selections.filter((selection) =>
      !selections.some((candidate) =>
        candidate.presetId.length > selection.presetId.length &&
        candidate.presetId.startsWith(selection.presetId)
      )
    );
    if (new Set(strongest.map((item) => item.enabled)).size > 1) {
      state.issues.push({ code: "conflicting-preset-target", featureId });
      continue;
    }
    const enabled = strongest[0].enabled;
    const presetId = strongest.map((item) => item.presetId).sort()[0];
    state.explicit.set(featureId, enabled);
    selectFeature(state, featureId, enabled, {
      kind: "preset",
      presetId,
    });
  }
}
