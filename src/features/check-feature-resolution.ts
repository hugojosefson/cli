/** @module Post-selection conflict and disable checks. */

import { selectCapabilityProvider } from "./select-capability-provider.ts";
import {
  isFeatureSelected,
  providerIds,
  type ResolutionState,
} from "./resolution-state.ts";

/** Resolves explicit exclusive providers after dependency closure. */
export function resolveExplicitExclusiveProviders(
  state: ResolutionState,
): void {
  for (const [id, enabled] of state.explicit) {
    if (!enabled) {
      continue;
    }
    for (
      const capabilityId of state.features.get(id)?.capabilities.provides ?? []
    ) {
      if (
        state.capabilities.get(capabilityId)?.providerPolicy === "exclusive"
      ) {
        selectCapabilityProvider(state, capabilityId, id);
      }
    }
  }
}

/** Checks exclusive capabilities touched by the request. */
export function checkExclusiveCapabilities(state: ResolutionState): void {
  for (
    const capability of state.registry.capabilities.filter((item) =>
      item.providerPolicy === "exclusive" &&
      state.touchedCapabilities.has(item.id)
    )
  ) {
    const selected = providerIds(state, capability.id).filter((id) =>
      isFeatureSelected(state, id) && state.desired.get(id)?.enabled !== false
    );
    if (selected.length > 1) {
      state.issues.push({
        code: "conflicting-exclusive-providers",
        capabilityId: capability.id,
      });
    }
  }
}

/** Checks whether explicit disables leave dependencies unsatisfied. */
export function checkFeatureDisables(state: ResolutionState): void {
  const remaining = [...state.features.keys()].filter((id) =>
    isFeatureSelected(state, id) && state.desired.get(id)?.enabled !== false
  );
  for (
    const disabledId of [...state.desired].filter(([, value]) => !value.enabled)
      .map(([id]) => id).sort()
  ) {
    for (const featureId of remaining) {
      if (
        state.features.get(featureId)?.dependencies.requires.some((item) =>
          item.featureId === disabledId
        )
      ) {
        state.issues.push({
          code: "direct-dependent-remains-enabled",
          featureId,
          relatedId: disabledId,
        });
      }
    }
    checkProviderDisable(state, disabledId, remaining);
  }
}

function checkProviderDisable(
  state: ResolutionState,
  disabledId: string,
  remaining: readonly string[],
): void {
  for (
    const capabilityId
      of state.features.get(disabledId)?.capabilities.provides ?? []
  ) {
    const hasOtherProvider = providerIds(state, capabilityId).some((id) =>
      id !== disabledId && remaining.includes(id)
    );
    if (hasOtherProvider) {
      continue;
    }
    for (const featureId of remaining) {
      if (
        state.features.get(featureId)?.capabilities.requires.some((item) =>
          item.capabilityId === capabilityId
        )
      ) {
        state.issues.push({
          code: "capability-consumer-remains-enabled",
          featureId,
          capabilityId,
          relatedId: disabledId,
        });
      }
    }
  }
}
