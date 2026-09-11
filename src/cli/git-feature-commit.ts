/** @module Automatic Git commit planning for local feature operations. */

import type { ChangePlan } from "../api/change-plan.ts";
import { repositoryRoot } from "../repository/repository-path.ts";

/** Returns sorted unique repository paths changed by local file operations. */
export function plannedCommitPaths(
  plans: readonly ChangePlan[],
): readonly string[] {
  const paths = plans.flatMap((plan) => plan.changes).flatMap((change) => {
    if (
      change.kind === "write-file" || change.kind === "create-symlink" ||
      change.kind === "remove-symlink" || change.kind === "remove-file" ||
      change.kind === "remove-directory" || change.kind === "set-file-mode" ||
      change.kind === "set-json" || change.kind === "remove-json"
    ) {
      return [change.path];
    }
    return [];
  });
  return [...new Set(paths)].sort();
}

/** Git can resolve both commit identities before a repository exists. */
export async function requireGitIdentity(root: URL): Promise<void> {
  for (const role of ["AUTHOR", "COMMITTER"] as const) {
    const result = await new Deno.Command("git", {
      args: ["var", `GIT_${role}_IDENT`],
      cwd: repositoryRoot(root).path,
    }).output();
    if (!result.success) {
      throw new Error(
        `Git ${role.toLowerCase()} identity is required.\n` +
          "Set the commit identity, then retry:\n" +
          '  git config --global user.name "Your Name"\n' +
          '  git config --global user.email "you@example.com"\n' +
          "No changes were made.",
      );
    }
  }
}

/** Builds the one automatic Conventional Commit for planned paths. */
export function featureCommitPlan(paths: readonly string[]): ChangePlan {
  return {
    featureId: "git",
    action: "enable",
    summary: "Commit planned paths.",
    warnings: [],
    preconditions: [],
    changes: [{
      kind: "git-commit",
      message: paths.length
        ? "chore: configure repository features"
        : "chore: init repo",
      paths,
      allowEmpty: paths.length === 0,
    }],
    validations: [],
  };
}
