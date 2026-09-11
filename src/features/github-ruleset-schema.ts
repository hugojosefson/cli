/** @module Pinned GitHub REST schema capabilities used by tag protection. */

export const githubRestSchemaCommit =
  "3fa67306b30ebd736a08604ff8b8932a34f68ddf";
export const githubRestSchemaSource =
  `https://github.com/github/rest-api-description/blob/${githubRestSchemaCommit}/descriptions/api.github.com/api.github.com.json`;

/** Values verified in the pinned schema, not inferred from a live repository. */
export const githubRulesetSchemaCapabilities = {
  targets: ["branch", "tag"],
  ruleTypes: ["tag_name_pattern"],
} as const;

export function schemaSupportsProtectedTags(): boolean {
  return githubRulesetSchemaCapabilities.targets.includes("tag") &&
    githubRulesetSchemaCapabilities.ruleTypes.includes("tag_name_pattern");
}
