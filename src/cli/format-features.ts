/** @module Stable terminal formatting for repository feature results. */

import { colorText, stateColor } from "./terminal-colors.ts";
import { formatTable } from "./format-table.ts";
import type { FeatureDetection } from "../api/feature-detection.ts";
import type { FeatureRegistry } from "../features/feature-registry.ts";
import { repairStateDescription } from "./feature-repair-preview.ts";

/** Formats every registered feature in declaration-independent ID order. */
export function formatFeatureStatus(
  registry: FeatureRegistry,
  detections: ReadonlyMap<string, FeatureDetection>,
  color = false,
  repairs: ReadonlyMap<string, string> = new Map(),
): string {
  const rows = registry.features.map((feature) => feature.metadata.id).sort()
    .map((id) => {
      const detection = detections.get(id);
      const details =
        detection && "issues" in detection && detection.issues.length
          ? detection.issues.map((issue) => issue.observation)
          : detection?.evidence.map((item) => item.observation) ?? [];
      const repair = repairs.get(id) ?? repairStateDescription(detection);
      return [
        id,
        detection?.state ?? "unknown",
        [
          ...new Set(details),
          ...(repair ? [`Repair: ${repair}`] : []),
        ].join("\n"),
      ];
    });
  return formatTable(["Feature", "Managed state", "Details and repair"], rows, [
    48,
    12,
    78,
  ], {
    color,
    columns: ["cyan", "state"],
    rows: rows.map((row) =>
      row[1] === "enabled" ? undefined : stateColor(row[1])
    ),
  });
}

export interface FeatureOperationResult {
  readonly committed: boolean;
  readonly finalTask?: string;
  readonly initializedGit: boolean;
  readonly localChanged: boolean;
  readonly githubChanged: boolean;
}

/** Reports local and remote changes separately, including operations without Git. */
export function formatFeatureResult(
  status: string,
  result: FeatureOperationResult,
  color = false,
): string {
  const rows: string[][] = [];
  if (result.finalTask) rows.push(["Project task", result.finalTask]);
  if (result.localChanged) rows.push(["Local files", "Applied local changes."]);
  if (result.committed) {
    rows.push([
      "Git",
      result.initializedGit
        ? "Initialized Git with an empty base; committed changed features."
        : "Committed each changed feature separately.",
    ]);
  }
  if (result.githubChanged) rows.push(["GitHub", "Applied GitHub changes."]);
  const summary = rows.length
    ? formatTable(["Area", "Result"], rows, undefined, {
      color,
      columns: ["cyan", "green"],
    })
    : colorText("No changes.", "dim", color);
  return `${status}\n\n${summary}`;
}
