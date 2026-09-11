/** @module Stable terminal formatting for repository feature results. */

import { colorText, stateColor } from "./terminal-colors.ts";
import { formatTable } from "./format-table.ts";
import type { FeatureDetection } from "../api/feature-detection.ts";
import type { FeatureRegistry } from "../features/feature-registry.ts";

/** Formats every registered feature in declaration-independent ID order. */
export function formatFeatureStatus(
  registry: FeatureRegistry,
  detections: ReadonlyMap<string, FeatureDetection>,
  color = false,
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
  ], {
    color,
    columns: ["cyan", "state"],
    rows: rows.map((row) =>
      row[1] === "enabled" ? undefined : stateColor(row[1])
    ),
  });
}

/** Formats a concise operation result. */
export function formatFeatureResult(
  status: string,
  committed: boolean,
  initializedWithoutCommit: boolean,
  githubChanged: boolean,
  color = false,
): string {
  const note = initializedWithoutCommit
    ? "Git was initialized; no commit was created because identity preflight is unavailable."
    : committed
    ? "Created one commit for planned paths."
    : githubChanged
    ? "Applied GitHub changes."
    : "No changes.";
  return `${status}\n\n${
    colorText(
      note,
      initializedWithoutCommit
        ? "yellow"
        : committed || githubChanged
        ? "green"
        : "dim",
      color,
    )
  }`;
}
