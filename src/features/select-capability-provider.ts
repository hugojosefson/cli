/** @module Capability-provider selection during feature resolution. */

import type { CapabilityId } from "../api/capability.ts";
import type { ResolvedChangeReason } from "../api/feature-change.ts";
import type { FeatureId } from "../api/feature.ts";
import {
  isFeaturePresent,
  isFeatureSelected,
  providerIds,
  type ResolutionState,
  selectFeature,
} from "./resolution-state.ts";

/** Selects one provider and plans replacement for an exclusive capability. */
export function selectCapabilityProvider(
  state: ResolutionState,
  capabilityId: CapabilityId,
  requiredBy: FeatureId | undefined,
  fallbackReason?: ResolvedChangeReason,
): void {
  state.touchedCapabilities.add(capabilityId);
  const definition = state.capabilities.get(capabilityId);
  if (definition === undefined) {
    return;
  }
  const providers = providerIds(state, capabilityId);
  const explicitlySelected = providers.filter((id) =>
    state.explicit.get(id) === true
  );
  const presentProviders = providers.filter((id) =>
    isFeaturePresent(state, id) && state.desired.get(id)?.enabled !== false
  );
  if (
    definition.providerPolicy === "exclusive" &&
    (explicitlySelected.length > 1 ||
      explicitlySelected.length === 0 && presentProviders.length > 1)
  ) {
    state.issues.push({
      code: "conflicting-exclusive-providers",
      capabilityId,
    });
    return;
  }
  const provider = explicitlySelected[0] ?? presentProviders[0] ??
    definition.defaultProvider;
  if (provider === undefined || state.explicit.get(provider) === false) {
    state.issues.push({
      code: "missing-capability-provider",
      featureId: requiredBy,
      capabilityId,
      relatedId: provider,
    });
    return;
  }
  if (
    !isFeatureSelected(state, provider) ||
    state.overwrite && !state.desired.has(provider) &&
      state.detections[provider]?.state !== "enabled"
  ) {
    selectFeature(
      state,
      provider,
      true,
      fallbackReason ?? {
        kind: "capability-default-provider",
        capabilityId,
        requiredBy: requiredBy ?? provider,
      },
    );
  }
  if (definition.providerPolicy !== "exclusive") {
    return;
  }
  for (
    const oldProvider of providers.filter((id) =>
      id !== provider && isFeaturePresent(state, id) &&
      state.desired.get(id)?.enabled !== false
    )
  ) {
    if (state.explicit.get(oldProvider) === true) {
      continue;
    }
    selectFeature(state, oldProvider, false, {
      kind: "exclusive-provider-replacement",
      capabilityId,
      replacedBy: provider,
    });
  }
}
