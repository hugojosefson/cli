/** @module Indexed feature and capability registry lookups. */

import type { FeatureRegistry } from "./feature-registry.ts";

/** Stable lookup data derived from a registry declaration. */
export interface RegistryIndex {
  readonly featureIds: ReadonlySet<string>;
  readonly capabilityIds: ReadonlySet<string>;
  readonly featureCounts: ReadonlyMap<string, number>;
  readonly capabilityCounts: ReadonlyMap<string, number>;
}

/** Indexes IDs without deciding whether duplicates are valid. */
export function indexRegistry(registry: FeatureRegistry): RegistryIndex {
  return {
    featureIds: new Set(
      registry.features.map((feature) => feature.metadata.id),
    ),
    capabilityIds: new Set(
      registry.capabilities.map((capability) => capability.id),
    ),
    featureCounts: count(
      registry.features.map((feature) => feature.metadata.id),
    ),
    capabilityCounts: count(
      registry.capabilities.map((capability) => capability.id),
    ),
  };
}

/** Returns duplicate IDs in deterministic order. */
export function duplicateIds(
  counts: ReadonlyMap<string, number>,
): readonly string[] {
  return [...counts].filter(([, value]) => value > 1).map(([id]) => id).sort();
}

function count(ids: readonly string[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}
