/** Ownership-guarded cleanup after collisions and interrupted requests. */
import {
  type ApplyClock,
  type ApplyGithub,
  type ApplyOutcome,
  type ApplyPullRequest,
  type PublishTagApplyInput,
  ReleaseApplyConflictError,
  ReleaseApplyTimeoutError,
  ReleasePullRequestNotFoundError,
} from "./apply-types.ts";
import {
  exactAutoMerge,
  ownedPullRequest,
  request,
  requestLimit,
  requireExactAutoMerge,
  requireOpenPullRequest,
  sameOwnership,
} from "./apply-observation.ts";
import { exactCancelledCheck, expectedChecks } from "./apply-checks.ts";
import {
  assertExactCurrentCheck,
  parseReleaseCheckExternalId,
  type SyntheticCheckRun,
} from "./synthetic-check.ts";
import { releaseBranch } from "./names.ts";
export async function sourceFirstCleanup(
  github: ApplyGithub,
  clock: ApplyClock,
  deadline: number,
  input: PublishTagApplyInput,
  _pr: ApplyPullRequest,
): Promise<ApplyOutcome> {
  let pr = await ownedPullRequest(github, input);
  if (pr.state === "MERGED") return "merged";
  requireOpenPullRequest(pr);
  requireExactAutoMerge(pr);
  if (
    await request(
      github,
      clock,
      deadline,
      input,
      () => github.disablePullRequestAutoMerge(pr.id),
      (current) => !current.autoMerge,
    )
  ) return "merged";
  pr = await ownedPullRequest(github, input);
  if (pr.state === "MERGED") return "merged";
  requireOpenPullRequest(pr);
  if (pr.autoMerge) {
    throw new ReleaseApplyConflictError("Auto-merge request remains.");
  }
  const result = await github.deleteReleaseBranchWithLease(
    releaseBranch(input.ownership.version),
    input.releaseSha,
  );
  if (result === "lease-mismatch") {
    throw new ReleaseApplyConflictError("Release branch lease changed.");
  }
  if (result === "deleted" || result === "missing") {
    pr = await ownedPullRequest(github, input);
    if (pr.state === "MERGED") return "merged";
    if (pr.state === "OPEN") {
      if (
        await request(
          github,
          clock,
          deadline,
          input,
          () => github.closePullRequest(pr.id),
          (current) => current.state === "CLOSED",
          true,
        )
      ) return "merged";
    }
  }
  return "source-first-collision";
}

export async function cleanStatusRecovery(
  github: ApplyGithub,
  clock: ApplyClock,
  deadline: number,
  input: PublishTagApplyInput,
): Promise<void> {
  const cleanupLimit = Math.min(deadline, clock.now() + requestLimit);
  const firstPullRequest = await readPullRequestForCleanup(
    github,
    clock,
    cleanupLimit,
  );
  const runs = await readCheckRunsForCleanup(
    github,
    clock,
    cleanupLimit,
    input.releaseSha,
  );
  const currentRuns = expectedChecks(input).map((check) => ({
    check,
    run: currentRunForCleanup(runs, check),
  }));
  const pullRequest = await readPullRequestForCleanup(
    github,
    clock,
    cleanupLimit,
  );
  const ownsPullRequest = [firstPullRequest, pullRequest].every((item) =>
    item.headSha === input.releaseSha &&
    sameOwnership(item.ownership, input.ownership)
  );
  if (ownsPullRequest && exactAutoMerge(pullRequest)) {
    await request(
      github,
      clock,
      deadline,
      input,
      () => github.disablePullRequestAutoMerge(pullRequest.id),
      (current) => !current.autoMerge,
    );
  }
  for (const { check, run } of currentRuns) {
    if (run?.status === "in_progress") {
      await cancelCheckForCleanup(
        github,
        clock,
        deadline,
        input.releaseSha,
        () => github.completeCheckRun(run.id, "cancelled"),
        (current) => exactCancelledCheck(current, check),
      );
    }
  }
  if (!ownsPullRequest) {
    throw new ReleaseApplyConflictError("Pull request ownership changed.");
  }
}

function currentRunForCleanup(
  runs: readonly SyntheticCheckRun[],
  check: ReturnType<typeof expectedChecks>[number],
): SyntheticCheckRun | undefined {
  const matches = runs.filter((run) => run.externalId === check.externalId);
  if (matches.length > 1) {
    throw new ReleaseApplyConflictError("Synthetic check is ambiguous.");
  }
  const run = matches[0];
  if (!run) return undefined;
  try {
    assertExactCurrentCheck(
      run,
      parseReleaseCheckExternalId(check.externalId)!,
      check.detailsUrl,
    );
  } catch {
    throw new ReleaseApplyConflictError("Synthetic check differs.");
  }
  if (
    !(run.status === "in_progress" && run.conclusion === null) &&
    !(run.status === "completed" &&
      (run.conclusion === "success" || run.conclusion === "cancelled"))
  ) {
    throw new ReleaseApplyConflictError("Synthetic check state is invalid.");
  }
  return run;
}

async function readPullRequestForCleanup(
  github: ApplyGithub,
  clock: ApplyClock,
  limit: number,
): Promise<ApplyPullRequest> {
  while (true) {
    try {
      return await github.readPullRequest();
    } catch (error) {
      if (error instanceof TypeError) {
        throw new ReleaseApplyConflictError("GitHub response is malformed.");
      }
      if (error instanceof ReleasePullRequestNotFoundError) {
        throw new ReleaseApplyConflictError("Release pull request is missing.");
      }
    }
    if (clock.now() >= limit) {
      throw new ReleaseApplyTimeoutError("Pull request cleanup read failed.");
    }
    await clock.sleep(5_000);
  }
}

async function readCheckRunsForCleanup(
  github: ApplyGithub,
  clock: ApplyClock,
  limit: number,
  releaseSha: string,
): Promise<readonly SyntheticCheckRun[]> {
  while (true) {
    try {
      return await github.listCheckRuns(releaseSha);
    } catch (error) {
      if (error instanceof TypeError) {
        throw new ReleaseApplyConflictError("GitHub response is malformed.");
      }
    }
    if (clock.now() >= limit) {
      throw new ReleaseApplyTimeoutError("Check-run cleanup read failed.");
    }
    await clock.sleep(5_000);
  }
}

async function cancelCheckForCleanup(
  github: ApplyGithub,
  clock: ApplyClock,
  deadline: number,
  releaseSha: string,
  operation: () => Promise<unknown>,
  expected: (runs: readonly SyntheticCheckRun[]) => boolean,
): Promise<void> {
  try {
    await operation();
  } catch { /* a read confirms an uncertain completion */ }
  const limit = Math.min(deadline, clock.now() + requestLimit);
  while (true) {
    try {
      if (expected(await github.listCheckRuns(releaseSha))) return;
    } catch (error) {
      if (error instanceof ReleaseApplyConflictError) throw error;
      if (error instanceof TypeError) {
        throw new ReleaseApplyConflictError("GitHub response is malformed.");
      }
    }
    if (clock.now() >= limit) {
      throw new ReleaseApplyTimeoutError(
        "Synthetic check cancellation was not confirmed.",
      );
    }
    await clock.sleep(5_000);
  }
}
