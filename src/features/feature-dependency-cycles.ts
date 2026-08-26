/** @module Feature and default-provider dependency cycle detection. */

import type { FeatureRegistry } from "./feature-registry.ts";

/** Lists features in cycles through direct or default-provider dependencies. */
export function featureDependencyCycles(
  registry: FeatureRegistry,
  ids: ReadonlySet<string>,
): readonly string[] {
  const capabilities = new Map(
    registry.capabilities.map((capability) => [capability.id, capability]),
  );
  const edges = new Map(
    registry.features.map((
      feature,
    ) => [
      feature.metadata.id,
      [
        ...feature.dependencies.requires.map((item) => item.featureId),
        ...feature.capabilities.requires.flatMap((requirement) => {
          const provider = capabilities.get(requirement.capabilityId)
            ?.defaultProvider;
          return provider === undefined ? [] : [provider];
        }),
      ].filter((id) => ids.has(id)),
    ]),
  );
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycles = new Set<string>();
  const path: string[] = [];
  const visit = (id: string): void => {
    if (visiting.has(id)) {
      for (const cycleId of path.slice(path.indexOf(id))) cycles.add(cycleId);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    path.push(id);
    for (const dependency of edges.get(id) ?? []) visit(dependency);
    path.pop();
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of [...edges.keys()].sort()) visit(id);
  return [...cycles].sort();
}
