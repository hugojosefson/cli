/** Bounded reads and confirmation after uncertain GitHub requests. */
import {
  type ApplyClock,
  type ApplyGithub,
  type ApplyPullRequest,
  type PublishTagApplyInput,
  ReleaseApplyConflictError,
  ReleaseApplyError,
  ReleaseApplyTimeoutError,
  ReleasePullRequestNotFoundError,
} from "./apply-types.ts";
import type { ReleaseOwnership } from "./release-pr.ts";
import type { SyntheticCheckRun } from "./synthetic-check.ts";
export const requestLimit = 60_000;
export async function ownedPullRequest(
  github: ApplyGithub,
  input: PublishTagApplyInput,
): Promise<ApplyPullRequest> {
  const pr = await github.readPullRequest();
  if (
    pr.headSha !== input.releaseSha ||
    !sameOwnership(pr.ownership, input.ownership)
  ) throw new ReleaseApplyConflictError("Pull request ownership changed.");
  return pr;
}

export function sameOwnership(
  a: ReleaseOwnership | undefined,
  b: ReleaseOwnership,
): boolean {
  return a !== undefined && JSON.stringify(a) === JSON.stringify(b);
}

export function requireExactAutoMerge(pr: ApplyPullRequest): void {
  if (!exactAutoMerge(pr)) {
    throw new ReleaseApplyConflictError("Auto-merge request differs.");
  }
}

export function requireOpenPullRequest(pr: ApplyPullRequest): void {
  if (pr.state === "CLOSED") {
    throw new ReleaseApplyError("Release pull request was closed.");
  }
}

export function exactAutoMerge(pr: ApplyPullRequest): boolean {
  return pr.autoMerge?.mergeMethod === "REBASE" &&
    pr.autoMerge.enabledBy.type === "Bot" &&
    pr.autoMerge.enabledBy.login === "github-actions";
}

export async function request(
  github: ApplyGithub,
  clock: ApplyClock,
  deadline: number,
  input: PublishTagApplyInput,
  operation: () => Promise<unknown>,
  expected: (
    pr: ApplyPullRequest,
    runs: readonly SyntheticCheckRun[],
  ) => boolean,
  allowClosedExpected = false,
): Promise<boolean> {
  try {
    await operation();
  } catch { /* read-after-write resolves uncertain results */ }
  return await observe(
    github,
    clock,
    Math.min(deadline, clock.now() + requestLimit),
    input,
    expected,
    allowClosedExpected,
  );
}

export async function observe(
  github: ApplyGithub,
  clock: ApplyClock,
  limit: number,
  input: PublishTagApplyInput,
  expected: (
    pr: ApplyPullRequest,
    runs: readonly SyntheticCheckRun[],
  ) => boolean,
  allowClosedExpected = false,
): Promise<boolean> {
  while (true) {
    try {
      const pr = await ownedPullRequest(github, input);
      if (pr.state === "MERGED") return true;
      if (!allowClosedExpected) requireOpenPullRequest(pr);
      if (expected(pr, await github.listCheckRuns(input.releaseSha))) {
        return false;
      }
      requireOpenPullRequest(pr);
    } catch (error) {
      if (
        error instanceof ReleaseApplyConflictError ||
        error instanceof ReleaseApplyError
      ) throw error;
      if (error instanceof ReleasePullRequestNotFoundError) {
        throw new ReleaseApplyConflictError("Release pull request is missing.");
      }
      if (error instanceof TypeError) {
        throw new ReleaseApplyConflictError("GitHub response is malformed.");
      }
    }
    if (clock.now() >= limit) {
      throw new ReleaseApplyTimeoutError("GitHub request was not confirmed.");
    }
    await clock.sleep(5_000);
  }
}
