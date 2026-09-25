/** @module Mutable state shared by the pure feature resolver. */

import type { CapabilityDefinition, CapabilityId } from "../api/capability.ts";
import type {
  ResolvedChangeReason,
  ResolvedFeatureChange,
} from "../api/feature-change.ts";
import type { FeatureDetection } from "../api/feature-detection.ts";
import type { Feature, FeatureId } from "../api/feature.ts";
import type { FeatureResolutionIssue } from "./feature-resolution.ts";
import type { FeatureRegistry } from "./feature-registry.ts";

/** A selected final state and why the resolver selected it. */
export interface DesiredFeatureState {
  readonly enabled: boolean;
  readonly reason: ResolvedChangeReason;
}

/** Internal state for one resolution pass. */
export interface ResolutionState {
  readonly registry: FeatureRegistry;
  readonly overwrite?: boolean;
  readonly detections: Readonly<Record<FeatureId, FeatureDetection>>;
  readonly features: ReadonlyMap<FeatureId, Feature>;
  readonly capabilities: ReadonlyMap<CapabilityId, CapabilityDefinition>;
  readonly explicit: Map<FeatureId, boolean>;
  readonly desired: Map<FeatureId, DesiredFeatureState>;
  readonly touchedCapabilities: Set<CapabilityId>;
  readonly issues: FeatureResolutionIssue[];
}

/** Returns whether detection treats a feature as currently present. */
export function isFeaturePresent(
  state: ResolutionState,
  id: FeatureId,
): boolean {
  const detected = state.detections[id]?.state;
  return detected === "enabled" || detected === "drifted";
}

/** Returns whether a feature is present or selected for enablement. */
export function isFeatureSelected(
  state: ResolutionState,
  id: FeatureId,
): boolean {
  return state.desired.get(id)?.enabled === true || isFeaturePresent(state, id);
}

/** Selects a feature unless an explicit disable or ambiguity prevents it. */
export function selectFeature(
  state: ResolutionState,
  id: FeatureId,
  enabled: boolean,
  reason: ResolvedChangeReason,
): void {
  if (!state.overwrite && state.detections[id]?.state === "ambiguous") {
    state.issues.push({ code: "ambiguous-feature", featureId: id });
    return;
  }
  if (state.desired.get(id)?.enabled === false && enabled) {
    return;
  }
  state.desired.set(id, { enabled, reason });
}

/** Returns providers for a capability in stable order. */
export function providerIds(
  state: ResolutionState,
  capabilityId: CapabilityId,
): readonly FeatureId[] {
  return state.registry.features.filter((feature) =>
    feature.capabilities.provides.includes(capabilityId)
  ).map((feature) => feature.metadata.id).sort();
}

/** Returns only selected states that differ from detected state. */
export function changedFeatures(
  state: ResolutionState,
  includeSelected = false,
): readonly ResolvedFeatureChange[] {
  return [...state.desired].filter(([id, value]) =>
    value.enabled !== isFeaturePresent(state, id) ||
    includeSelected && value.enabled
  ).map(([featureId, value]) => ({ featureId, ...value }));
}
