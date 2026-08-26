/** @module Public entry point for pure feature-change resolution. */

import type { FeatureChangeRequest } from "../api/feature-change.ts";
import type { FeatureDetection } from "../api/feature-detection.ts";
import type { FeatureId } from "../api/feature.ts";
import type { FeatureRegistry } from "./feature-registry.ts";
import type { FeatureChangeResolution } from "./feature-resolution.ts";
import { resolveRegistryChanges } from "./resolve-registry-changes.ts";
import { validateFeatureRegistry } from "./validate-feature-registry.ts";

/** Resolves changes without inspecting or changing repository artifacts. */
export function resolveFeatureChanges(
  registry: FeatureRegistry,
  detections: Readonly<Record<FeatureId, FeatureDetection>>,
  request: FeatureChangeRequest,
): FeatureChangeResolution {
  const registryIssues = validateFeatureRegistry(registry);
  if (registryIssues.length > 0) {
    return {
      changes: [],
      issues: registryIssues.map((registryIssue) => ({
        code: "invalid-registry",
        registryIssue,
      })),
    };
  }
  return resolveRegistryChanges(registry, detections, request);
}
