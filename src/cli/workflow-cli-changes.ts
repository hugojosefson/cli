/** @module Keeps source changes actionable when workflow features are already enabled. */
import type {
  FeatureChangeRequest,
  ResolvedFeatureChange,
} from "../api/feature-change.ts";
import type { FeatureRegistry } from "../features/feature-registry.ts";

export function workflowCliChanges(
  request: FeatureChangeRequest,
  registry: FeatureRegistry,
  existing: readonly ResolvedFeatureChange[],
): readonly ResolvedFeatureChange[] {
  const selected = new Map(
    (registry.presets ?? []).filter((preset) =>
      request.presets.includes(preset.id)
    )
      .flatMap((preset) => preset.changes).map((
        change,
      ) => [change.featureId, change.enabled]),
  );
  for (const change of request.changes) {
    selected.set(change.featureId, change.enabled);
  }
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id) || selected.get(id) === false) return;
    visited.add(id);
    for (
      const dependency of registry.features.find((feature) =>
        feature.metadata.id === id
      )!.dependencies.requires
    ) visit(dependency.featureId);
  };
  for (const [id, enabled] of selected) if (enabled) visit(id);
  return [...visited].filter((id) =>
    (id === "github-ci" || id.startsWith("github-release-publish-")) &&
    !existing.some((change) => change.featureId === id)
  ).map((featureId) => ({
    featureId,
    enabled: true,
    reason: { kind: "explicit-request" },
  }));
}
