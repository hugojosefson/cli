/** @module Validation for feature and capability declarations. */

import { featureDependencyCycles } from "./feature-dependency-cycles.ts";
import type { FeatureRegistry } from "./feature-registry.ts";
import { duplicateIds, indexRegistry } from "./registry-index.ts";

/** A declaration problem that prevents reliable feature resolution. */
export interface FeatureRegistryIssue {
  readonly code:
    | "duplicate-feature-id"
    | "duplicate-capability-id"
    | "duplicate-preset-id"
    | "preset-id-collides-with-feature-id"
    | "preset-id-collides-with-capability-id"
    | "unknown-preset-target-feature"
    | "contradictory-preset-target"
    | "duplicate-direct-dependency"
    | "duplicate-provided-capability"
    | "duplicate-required-capability"
    | "duplicate-feature-conflict"
    | "duplicate-disable-conflict"
    | "unknown-direct-dependency"
    | "unknown-feature-conflict"
    | "unknown-disable-conflict"
    | "self-feature-conflict"
    | "self-disable-conflict"
    | "dependency-cycle"
    | "unknown-required-capability"
    | "unknown-provided-capability"
    | "invalid-default-provider"
    | "default-provider-does-not-provide-capability"
    | "invalid-exclusive-provider-setup";
  readonly featureId?: string;
  readonly capabilityId?: string;
  readonly relatedId?: string;
}

/** Checks structural feature-registry constraints in stable order. */
export function validateFeatureRegistry(
  registry: FeatureRegistry,
): readonly FeatureRegistryIssue[] {
  const index = indexRegistry(registry);
  const issues: FeatureRegistryIssue[] = [];
  for (const id of duplicateIds(index.featureCounts)) {
    issues.push({ code: "duplicate-feature-id", featureId: id });
  }
  for (const id of duplicateIds(index.capabilityCounts)) {
    issues.push({ code: "duplicate-capability-id", capabilityId: id });
  }
  validatePresets(registry, index.featureIds, index.capabilityIds, issues);
  for (
    const feature of [...registry.features].sort((a, b) =>
      a.metadata.id.localeCompare(b.metadata.id)
    )
  ) validateFeature(feature, index.featureIds, index.capabilityIds, issues);
  for (const featureId of featureDependencyCycles(registry, index.featureIds)) {
    issues.push({ code: "dependency-cycle", featureId });
  }
  for (
    const capability of [...registry.capabilities].sort((a, b) =>
      a.id.localeCompare(b.id)
    )
  ) {
    validateCapability(
      capability.id,
      capability.providerPolicy,
      capability.defaultProvider,
      registry,
      index.featureIds,
      issues,
    );
  }
  return issues;
}

function validatePresets(
  registry: FeatureRegistry,
  featureIds: ReadonlySet<string>,
  capabilityIds: ReadonlySet<string>,
  issues: FeatureRegistryIssue[],
): void {
  const presets = registry.presets ?? [];
  const counts = new Map<string, number>();
  for (const preset of presets) {
    counts.set(preset.id, (counts.get(preset.id) ?? 0) + 1);
  }
  for (const id of duplicateIds(counts)) {
    issues.push({ code: "duplicate-preset-id", relatedId: id });
  }
  for (const preset of [...presets].sort((a, b) => a.id.localeCompare(b.id))) {
    if (featureIds.has(preset.id)) {
      issues.push({
        code: "preset-id-collides-with-feature-id",
        relatedId: preset.id,
      });
    }
    if (capabilityIds.has(preset.id)) {
      issues.push({
        code: "preset-id-collides-with-capability-id",
        relatedId: preset.id,
      });
    }
    const targets = new Map<string, boolean>();
    for (const target of preset.changes) {
      if (!featureIds.has(target.featureId)) {
        issues.push({
          code: "unknown-preset-target-feature",
          featureId: preset.id,
          relatedId: target.featureId,
        });
      }
      const previous = targets.get(target.featureId);
      if (previous !== undefined && previous !== target.enabled) {
        issues.push({
          code: "contradictory-preset-target",
          featureId: preset.id,
          relatedId: target.featureId,
        });
      }
      targets.set(target.featureId, target.enabled);
    }
  }
}

function validateFeature(
  feature: FeatureRegistry["features"][number],
  featureIds: ReadonlySet<string>,
  capabilityIds: ReadonlySet<string>,
  issues: FeatureRegistryIssue[],
): void {
  const id = feature.metadata.id;
  validateIds(
    feature.dependencies.requires.map((item) => item.featureId),
    "duplicate-direct-dependency",
    id,
    issues,
  );
  validateIds(
    feature.capabilities.provides,
    "duplicate-provided-capability",
    id,
    issues,
  );
  validateIds(
    feature.capabilities.requires.map((item) => item.capabilityId),
    "duplicate-required-capability",
    id,
    issues,
  );
  validateIds(
    feature.conflicts?.featureIds ?? [],
    "duplicate-feature-conflict",
    id,
    issues,
  );
  validateIds(
    feature.conflicts?.disableWith ?? [],
    "duplicate-disable-conflict",
    id,
    issues,
  );
  for (const dependency of feature.dependencies.requires) {
    if (!featureIds.has(dependency.featureId)) {
      issues.push({
        code: "unknown-direct-dependency",
        featureId: id,
        relatedId: dependency.featureId,
      });
    }
  }
  for (const capabilityId of feature.capabilities.provides) {
    if (!capabilityIds.has(capabilityId)) {
      issues.push({
        code: "unknown-provided-capability",
        featureId: id,
        capabilityId,
      });
    }
  }
  for (const item of feature.capabilities.requires) {
    if (!capabilityIds.has(item.capabilityId)) {
      issues.push({
        code: "unknown-required-capability",
        featureId: id,
        capabilityId: item.capabilityId,
      });
    }
  }
  validateConflictReferences(
    id,
    feature.conflicts?.featureIds ?? [],
    featureIds,
    "unknown-feature-conflict",
    "self-feature-conflict",
    issues,
  );
  validateConflictReferences(
    id,
    feature.conflicts?.disableWith ?? [],
    featureIds,
    "unknown-disable-conflict",
    "self-disable-conflict",
    issues,
  );
}

function validateConflictReferences(
  featureId: string,
  relatedIds: readonly string[],
  featureIds: ReadonlySet<string>,
  unknownCode: FeatureRegistryIssue["code"],
  selfCode: FeatureRegistryIssue["code"],
  issues: FeatureRegistryIssue[],
): void {
  for (const relatedId of relatedIds) {
    if (relatedId === featureId) {
      issues.push({ code: selfCode, featureId, relatedId });
    } else if (!featureIds.has(relatedId)) {
      issues.push({ code: unknownCode, featureId, relatedId });
    }
  }
}

function validateIds(
  ids: readonly string[],
  code: FeatureRegistryIssue["code"],
  featureId: string,
  issues: FeatureRegistryIssue[],
): void {
  for (
    const id of duplicateIds(
      new Map(ids.map((id) => [id, ids.filter((item) => item === id).length])),
    )
  ) issues.push({ code, featureId, relatedId: id });
}
function validateCapability(
  id: string,
  policy: string,
  defaultProvider: string | undefined,
  registry: FeatureRegistry,
  featureIds: ReadonlySet<string>,
  issues: FeatureRegistryIssue[],
): void {
  const providers = registry.features.filter((feature) =>
    feature.capabilities.provides.includes(id)
  );
  if (policy === "exclusive" && providers.length === 0) {
    issues.push({ code: "invalid-exclusive-provider-setup", capabilityId: id });
  }
  if (defaultProvider === undefined) return;
  if (!featureIds.has(defaultProvider)) {
    issues.push({
      code: "invalid-default-provider",
      capabilityId: id,
      relatedId: defaultProvider,
    });
    return;
  }
  if (!providers.some((feature) => feature.metadata.id === defaultProvider)) {
    issues.push({
      code: "default-provider-does-not-provide-capability",
      capabilityId: id,
      relatedId: defaultProvider,
    });
  }
}
