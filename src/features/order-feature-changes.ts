/** @module Deterministic operational ordering for resolved changes. */

import type { ResolvedFeatureChange } from "../api/feature-change.ts";
import type { FeatureRegistry } from "./feature-registry.ts";

/** Orders enables before their consumers and disables before their dependencies. */
export function orderFeatureChanges(
  registry: FeatureRegistry,
  changes: readonly ResolvedFeatureChange[],
): readonly ResolvedFeatureChange[] {
  const byId = new Map(changes.map((change) => [change.featureId, change]));
  const ordered: ResolvedFeatureChange[] = [];
  const visited = new Set<string>();
  const visit = (id: string, enabled: boolean): void => {
    if (visited.has(id)) {
      return;
    }
    visited.add(id);
    const feature = registry.features.find((item) => item.metadata.id === id);
    const dependencies =
      feature?.dependencies.requires.map((item) => item.featureId).sort() ?? [];
    if (enabled) {
      for (const dependency of dependencies) visit(dependency, true);
      const requiredCapabilities = feature?.capabilities.requires.map((item) =>
        item.capabilityId
      ) ?? [];
      for (
        const provider of [...changes].filter((change) =>
          change.enabled && change.featureId !== id &&
          registry.features.find((item) =>
            item.metadata.id === change.featureId
          )
            ?.capabilities.provides.some((capabilityId) =>
              requiredCapabilities.includes(capabilityId)
            )
        ).sort(byFeatureId)
      ) visit(provider.featureId, true);
    }
    const change = byId.get(id);
    if (!enabled) {
      const dependents = registry.features.filter((item) =>
        item.dependencies.requires.some((dependency) =>
          dependency.featureId === id
        )
      ).map((item) => item.metadata.id).sort();
      for (const dependent of dependents) visit(dependent, false);
    }
    if (change?.enabled === enabled) ordered.push(change);
    if (!enabled) {
      for (const dependency of dependencies) visit(dependency, false);
    }
  };
  for (
    const change of [...changes].filter((item) => item.enabled).sort(
      byFeatureId,
    )
  ) visit(change.featureId, true);
  for (
    const change of [...changes].filter((item) => !item.enabled).sort(
      byFeatureId,
    )
  ) visit(change.featureId, false);
  return ordered;
}

function byFeatureId(
  left: ResolvedFeatureChange,
  right: ResolvedFeatureChange,
): number {
  return left.featureId.localeCompare(right.featureId);
}
