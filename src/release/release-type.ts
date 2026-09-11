/** @module Selects the release increment from validated Conventional Commits. */

export type ReleaseType = "major" | "minor" | "patch";

export type ValidatedConventionalCommit = {
  readonly type: string;
  readonly breaking: boolean;
};

/** Breaking changes win, then features, then patch-level commit types. */
export function selectReleaseType(
  commits: readonly ValidatedConventionalCommit[],
): ReleaseType | undefined {
  if (commits.length === 0) {
    return undefined;
  }
  if (commits.some((commit) => commit.breaking)) {
    return "major";
  }
  if (commits.some((commit) => commit.type === "feat")) {
    return "minor";
  }
  return "patch";
}
