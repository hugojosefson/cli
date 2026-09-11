import {
  type ApplyClock,
  type ApplyGithub,
  type ApplyOutcome,
  type ApplyPullRequest,
  type PublishTagApplyInput,
  PullRequestCleanStatusError,
  ReleaseApplyConflictError,
  ReleaseApplyError,
  ReleaseApplyTimeoutError,
} from "./apply-types.ts";
import {
  exactAutoMerge,
  observe,
  ownedPullRequest,
  request,
  requestLimit,
  requireExactAutoMerge,
  requireOpenPullRequest,
} from "./apply-observation.ts";
import {
  exactCancelledCheck,
  exactCheck,
  expectedChecks,
} from "./apply-checks.ts";
import { cleanStatusRecovery, sourceFirstCleanup } from "./apply-cleanup.ts";
/** Injectable protocol state machine for the publish-tag apply phase. */

import { releaseOwnershipMarker } from "./release-pr.ts";
import {
  classifyReleaseCheck,
  type ParsedReleaseCheckId,
  parseReleaseCheckExternalId,
  releaseCheckExternalId,
  releaseCheckIntegrationId,
  type SyntheticCheckRun,
} from "./synthetic-check.ts";

const deadlineDuration = 29 * 60_000;

export async function applyPublishTag(
  github: ApplyGithub,
  clock: ApplyClock,
  input: PublishTagApplyInput,
): Promise<ApplyOutcome> {
  validateInput(input);
  const deadline = clock.now() + deadlineDuration;
  try {
    return await runApplyPublishTag(github, clock, deadline, input);
  } catch (error) {
    await cleanStatusRecovery(github, clock, deadline, input);
    throw error;
  }
}

async function runApplyPublishTag(
  github: ApplyGithub,
  clock: ApplyClock,
  deadline: number,
  input: PublishTagApplyInput,
): Promise<ApplyOutcome> {
  let pullRequest = await ownedPullRequest(github, input);
  if (pullRequest.state === "MERGED") return "merged";
  requireOpenPullRequest(pullRequest);
  if (pullRequest.autoMerge) {
    requireExactAutoMerge(pullRequest);
    if (
      await request(
        github,
        clock,
        deadline,
        input,
        () => github.disablePullRequestAutoMerge(pullRequest.id),
        (pr) => !pr.autoMerge,
      )
    ) return "merged";
    pullRequest = await ownedPullRequest(github, input);
    if (pullRequest.state === "MERGED") return "merged";
    requireOpenPullRequest(pullRequest);
  }
  const expected = expectedChecks(input);
  for (const check of expected) {
    if (
      await request(
        github,
        clock,
        deadline,
        input,
        () =>
          github.createCheckRun({
            ...check,
            detailsUrl: input.detailsUrl,
          }),
        (_pr, runs) => exactCheck(runs, check, "in_progress"),
      )
    ) return "merged";
  }
  if (await requireBlocked(github, clock, deadline, input, expected)) {
    return "merged";
  }
  if (await neutralizeOlderRuns(github, clock, deadline, input, expected)) {
    return "merged";
  }
  if (await requireBlocked(github, clock, deadline, input, expected)) {
    return "merged";
  }
  pullRequest = await ownedPullRequest(github, input);
  if (pullRequest.state === "MERGED") return "merged";
  requireOpenPullRequest(pullRequest);
  requireExactBlockedState(
    pullRequest,
    await github.listCheckRuns(input.releaseSha),
    expected,
  );
  if (
    await enableAutoMerge(
      github,
      clock,
      deadline,
      input,
      pullRequest,
      expected,
    )
  ) return "merged";
  for (const check of expected) {
    const run = await singleExactRun(github, input.releaseSha, check);
    if (
      await request(
        github,
        clock,
        deadline,
        input,
        () => github.completeCheckRun(run.id, "success"),
        (_pr, runs) => exactCheck(runs, check, "success"),
      )
    ) return "merged";
  }
  return await waitForPullRequest(github, clock, deadline, input);
}

async function requireBlocked(
  github: ApplyGithub,
  clock: ApplyClock,
  deadline: number,
  input: PublishTagApplyInput,
  expected: ReturnType<typeof expectedChecks>,
): Promise<boolean> {
  return await observe(
    github,
    clock,
    Math.min(deadline, clock.now() + requestLimit),
    input,
    (pr, runs) =>
      pr.mergeStateStatus === "BLOCKED" &&
      expected.every((check) => exactCheck(runs, check, "in_progress")),
  );
}
function requireExactBlockedState(
  pullRequest: ApplyPullRequest,
  runs: readonly SyntheticCheckRun[],
  expected: ReturnType<typeof expectedChecks>,
): void {
  if (
    pullRequest.mergeStateStatus !== "BLOCKED" ||
    !expected.every((check) => exactCheck(runs, check, "in_progress"))
  ) {
    throw new ReleaseApplyConflictError(
      "Release pull request is not blocked by the new checks.",
    );
  }
}
async function neutralizeOlderRuns(
  github: ApplyGithub,
  clock: ApplyClock,
  deadline: number,
  input: PublishTagApplyInput,
  expected: ReturnType<typeof expectedChecks>,
): Promise<boolean> {
  const runs = await github.listCheckRuns(input.releaseSha);
  for (const run of runs) {
    if (!run.externalId) continue;
    let parsed: ParsedReleaseCheckId | undefined;
    try {
      parsed = parseReleaseCheckExternalId(run.externalId);
    } catch {
      throw new ReleaseApplyConflictError(
        "Synthetic check external ID is malformed.",
      );
    }
    if (!parsed) continue;
    const current = expected.find((check) => check.name === parsed.context);
    if (!current) continue;
    const identity: ParsedReleaseCheckId = {
      ...input,
      context: parsed.context,
    };
    const ownership = classifyReleaseCheck(run, identity);
    if (ownership === "different") continue;
    if (ownership === "older") {
      assertExactOlderCheck(run, parsed, input);
      if (run.status === "in_progress") {
        if (
          await request(
            github,
            clock,
            deadline,
            input,
            () => github.completeCheckRun(run.id, "neutral"),
            (_pr, checks) =>
              exactOlderCheck(checks, run.id, parsed, input, "neutral"),
          )
        ) return true;
      } else if (
        run.status !== "completed" ||
        !["success", "neutral", "cancelled"].includes(String(run.conclusion))
      ) {
        throw new ReleaseApplyConflictError(
          "Older synthetic check is invalid.",
        );
      }
    }
  }
  return false;
}
function assertExactOlderCheck(
  run: SyntheticCheckRun,
  parsed: ParsedReleaseCheckId,
  input: PublishTagApplyInput,
): void {
  if (
    run.name !== parsed.context || run.headSha !== parsed.releaseSha ||
    run.integrationId !== releaseCheckIntegrationId ||
    run.detailsUrl !== detailsUrlForRun(input, parsed.runId) ||
    (run.status === "in_progress" && run.conclusion !== null)
  ) {
    throw new ReleaseApplyConflictError("Older synthetic check differs.");
  }
}
function exactOlderCheck(
  runs: readonly SyntheticCheckRun[],
  id: number,
  parsed: ParsedReleaseCheckId,
  input: PublishTagApplyInput,
  conclusion: "neutral",
): boolean {
  const matches = runs.filter((run) => run.id === id);
  if (matches.length !== 1) {
    throw new ReleaseApplyConflictError("Older synthetic check disappeared.");
  }
  assertExactOlderCheck(matches[0], parsed, input);
  return matches[0].status === "completed" &&
    matches[0].conclusion === conclusion;
}
async function singleExactRun(
  github: ApplyGithub,
  sha: string,
  check: {
    name: string;
    headSha: string;
    externalId: string;
    detailsUrl: string;
  },
): Promise<SyntheticCheckRun> {
  const runs = await github.listCheckRuns(sha);
  if (!exactCheck(runs, check, "in_progress")) {
    throw new ReleaseApplyConflictError("New synthetic check disappeared.");
  }
  return runs.find((run) => run.externalId === check.externalId)!;
}

async function enableAutoMerge(
  github: ApplyGithub,
  clock: ApplyClock,
  deadline: number,
  input: PublishTagApplyInput,
  pullRequest: ApplyPullRequest,
  expected: ReturnType<typeof expectedChecks>,
): Promise<boolean> {
  try {
    await github.enablePullRequestAutoMerge({
      id: pullRequest.id,
      mergeMethod: "REBASE",
      expectedHeadOid: input.releaseSha,
    });
  } catch (error) {
    if (error instanceof PullRequestCleanStatusError) {
      const current = await ownedPullRequest(github, input);
      if (current.state === "MERGED") return true;
      requireOpenPullRequest(current);
      if (!exactAutoMerge(current)) {
        if (
          await cancelCurrentRuns(
            github,
            clock,
            deadline,
            input,
            expected,
          )
        ) return true;
        throw new ReleaseApplyConflictError(
          "GitHub reported clean status without an exact auto-merge request.",
        );
      }
      return false;
    }
  }
  return await observe(
    github,
    clock,
    Math.min(deadline, clock.now() + requestLimit),
    input,
    (pr) => exactAutoMerge(pr),
  );
}

async function cancelCurrentRuns(
  github: ApplyGithub,
  clock: ApplyClock,
  deadline: number,
  input: PublishTagApplyInput,
  expected: ReturnType<typeof expectedChecks>,
): Promise<boolean> {
  const runs = await github.listCheckRuns(input.releaseSha);
  for (const check of expected) {
    const matches = runs.filter((run) => run.externalId === check.externalId);
    if (matches.length > 1) {
      throw new ReleaseApplyConflictError("Synthetic check is ambiguous.");
    }
    if (matches[0]?.status === "in_progress") {
      if (!exactCheck(matches, check, "in_progress")) {
        throw new ReleaseApplyConflictError("Synthetic check differs.");
      }
      if (
        await request(
          github,
          clock,
          deadline,
          input,
          () => github.completeCheckRun(matches[0].id, "cancelled"),
          (_pr, current) => exactCancelledCheck(current, check),
        )
      ) return true;
    }
  }
  return false;
}
async function waitForPullRequest(
  github: ApplyGithub,
  clock: ApplyClock,
  deadline: number,
  input: PublishTagApplyInput,
): Promise<ApplyOutcome> {
  while (true) {
    const pr = await ownedPullRequest(github, input);
    if (pr.state === "MERGED") return "merged";
    if (pr.state === "CLOSED") {
      throw new ReleaseApplyError("Release pull request was closed.");
    }
    if (!exactAutoMerge(pr)) {
      throw new ReleaseApplyConflictError("Auto-merge request disappeared.");
    }
    if (await github.fetchMainSha() !== input.selectedSha) {
      return await sourceFirstCleanup(github, clock, deadline, input, pr);
    }
    if (clock.now() >= deadline) {
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
      throw new ReleaseApplyTimeoutError(
        "Release pull request did not merge before the deadline.",
      );
    }
    await clock.sleep(10_000);
  }
}

function validateInput(input: PublishTagApplyInput): void {
  let detailsUrl: URL;
  try {
    detailsUrl = new URL(input.detailsUrl);
  } catch {
    throw new TypeError("Release details URL is invalid.");
  }
  if (
    input.releaseSha !== input.ownership.branchHead ||
    input.selectedSha !== input.ownership.selectedSha ||
    !/^[1-9][0-9]{0,19}$/.test(input.runId) ||
    !/^[1-9][0-9]{0,9}$/.test(input.runAttempt) ||
    !/^[0-9a-f]{64}$/.test(input.bundleDigest) ||
    !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(input.releaseSha) ||
    !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(input.selectedSha) ||
    detailsUrl.protocol !== "https:" || detailsUrl.username ||
    detailsUrl.password || detailsUrl.search || detailsUrl.hash ||
    !input.detailsUrl.endsWith(`/actions/runs/${input.runId}`)
  ) throw new TypeError("Release apply input is inconsistent.");
  releaseOwnershipMarker(input.ownership);
  for (const check of expectedChecks(input)) {
    releaseCheckExternalId({
      ...input,
      context: check.name,
    });
  }
}

function detailsUrlForRun(
  input: PublishTagApplyInput,
  runId: string,
): string {
  const suffix = `/actions/runs/${input.runId}`;
  if (!input.detailsUrl.endsWith(suffix)) {
    throw new ReleaseApplyConflictError("Synthetic check details URL differs.");
  }
  return input.detailsUrl.slice(0, -suffix.length) + `/actions/runs/${runId}`;
}

/** Cleanup after an unconfirmed request; never changes data without current ownership. */
