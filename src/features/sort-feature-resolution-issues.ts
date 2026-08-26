/** @module Deduplication and stable ordering of resolution issues. */

import type { FeatureResolutionIssue } from "./feature-resolution.ts";

/** Returns one of each issue in deterministic display order. */
export function sortFeatureResolutionIssues(
  issues: readonly FeatureResolutionIssue[],
): readonly FeatureResolutionIssue[] {
  const unique = new Map<string, FeatureResolutionIssue>();
  for (const issue of issues) {
    unique.set(issueKey(issue), issue);
  }
  return [...unique.values()].sort((left, right) =>
    issueKey(left).localeCompare(issueKey(right))
  );
}

function issueKey(issue: FeatureResolutionIssue): string {
  return `${issue.code}:${issue.featureId ?? ""}:${issue.capabilityId ?? ""}:${
    issue.relatedId ?? ""
  }`;
}
