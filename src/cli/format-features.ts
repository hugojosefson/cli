/** @module Stable terminal formatting for repository feature results. */

import type { FeatureDetection } from "../api/feature-detection.ts";
import type { FeatureRegistry } from "../features/feature-registry.ts";

/** Formats every registered feature in declaration-independent ID order. */
export function formatFeatureStatus(
  registry: FeatureRegistry,
  detections: ReadonlyMap<string, FeatureDetection>,
): string {
  return registry.features
    .map((feature) => feature.metadata.id)
    .sort()
    .map((id) => `${id}: ${detections.get(id)?.state ?? "unknown"}`)
    .join("\n");
}

/** Formats a concise operation result. */
export function formatFeatureResult(
  status: string,
  committed: boolean,
  initializedWithoutCommit: boolean,
  githubChanged: boolean,
): string {
  const note = initializedWithoutCommit
    ? "Git was initialized; no commit was created because identity preflight is unavailable."
    : committed
    ? "Created one commit for planned paths."
    : githubChanged
    ? "Applied GitHub changes."
    : "No changes.";
  return `${status}\n${note}`;
}
