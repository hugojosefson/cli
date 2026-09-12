/** Distinguish an unlinked repository from a failed GitHub read. */
import {
  githubReadDifference,
  githubReadResolution,
} from "./github-read-difference.ts";
import type { DetectionContext } from "../api/repository-context.ts";

export const githubAccessResolution =
  "Run `git remote -v` to check the repository link and `gh auth status` to check access; if GitHub is rate limited, wait for its reset and retry. Do not change repository settings until reads succeed.";

/** Call only after the GitHub repository lookup returned unavailable. */
export async function unavailableGithubRepository(
  context: DetectionContext,
) {
  const linked = (await context.git.remotes()).length > 0;
  const evidence = {
    code: "github-repository-unavailable",
    kind: "github-repository",
    subject: { kind: "repository", identifier: context.repositoryRoot.href },
    observation: linked
      ? githubReadDifference(
        context,
        "GitHub repository",
        "repository metadata for the configured Git remote",
      )
      : "No Git remote links this repository to GitHub.",
  };
  return linked
    ? {
      state: "ambiguous" as const,
      evidence: [evidence],
      issues: [{ ...evidence, resolution: githubReadResolution(context) }],
    }
    : { state: "disabled" as const, evidence: [evidence] };
}
