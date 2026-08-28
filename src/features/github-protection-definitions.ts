/** @module Canonical GitHub repository rulesets managed by hj. */

import type { JsonObject, JsonValue } from "../api/json.ts";

export const rulesetResource = "repository-ruleset";
export const mainProtectionDefinition = ruleset(
  "hj/github-main-protection",
  "branch",
  [],
  [
    { type: "deletion" },
    { type: "non_fast_forward" },
    { type: "pull_request", parameters: pullRequest(false, false, false, 0) },
    {
      type: "required_status_checks",
      parameters: {
        do_not_enforce_on_create: false,
        required_status_checks: [{ context: "check", integration_id: 15368 }],
        strict_required_status_checks_policy: true,
      },
    },
  ],
);
export const mainReviewDefinition = ruleset("hj/github-main-review", "branch", [
  { actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "pull_request" },
], [{ type: "pull_request", parameters: pullRequest(true, true, true, 1) }]);
export const protectedTagsDefinition = ruleset(
  "hj/github-protected-tags",
  "tag",
  [{ actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" }],
  [{ type: "creation" }, { type: "update" }, { type: "deletion" }, {
    type: "non_fast_forward",
  }],
);

function pullRequest(
  stale: boolean,
  lastPush: boolean,
  extra: boolean,
  approvals: number,
) {
  return {
    allowed_merge_methods: ["merge", "squash", "rebase"],
    dismiss_stale_reviews_on_push: stale,
    require_code_owner_review: false,
    require_extra_approval_for_unattributed_changes: extra,
    require_last_push_approval: lastPush,
    required_approving_review_count: approvals,
    required_review_thread_resolution: true,
    required_reviewers: [],
  };
}
function ruleset(
  name: string,
  target: "branch" | "tag",
  bypassActors: readonly JsonValue[],
  rules: readonly JsonValue[],
): JsonObject {
  return canonical({
    name,
    target,
    enforcement: "active",
    bypass_actors: bypassActors,
    conditions: {
      ref_name: {
        include: [target === "branch" ? "~DEFAULT_BRANCH" : "~ALL"],
        exclude: [],
      },
    },
    rules,
  }) as JsonObject;
}
export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonical).sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b))
    );
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
        a.localeCompare(b)
      ).map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}
