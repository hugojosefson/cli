/** @module Stable terminal formatting for repository feature results. */

import { formatTable } from "./format-table.ts";
import type { FeatureDetection } from "../api/feature-detection.ts";
import type { FeatureRegistry } from "../features/feature-registry.ts";

/** Formats every registered feature in declaration-independent ID order. */
export function formatFeatureStatus(
  registry: FeatureRegistry,
  detections: ReadonlyMap<string, FeatureDetection>,
): string {
  const rows = registry.features.map((feature) => feature.metadata.id).sort()
    .map((id) => {
      const detection = detections.get(id);
      const details =
        detection && "issues" in detection && detection.issues.length
          ? detection.issues.map((issue) => issue.observation)
          : detection?.evidence.map((item) => item.observation) ?? [];
      return [
        id,
        detection?.state ?? "unknown",
        [...new Set(details)].join("\n"),
      ];
    });
  return formatTable(["Feature", "Managed state", "Details"], rows, [
    48,
    12,
    64,
  ]);
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
  return `${status}\n\n${note}`;
}
