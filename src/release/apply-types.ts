/** Contracts and errors shared by release application and recovery. */
import type { ReleaseOwnership } from "./release-pr.ts";
import type { SyntheticCheckRun } from "./synthetic-check.ts";

export class ReleaseApplyConflictError extends Error {}
export class ReleaseApplyTimeoutError extends Error {}
export class ReleaseApplyError extends Error {}
export class PullRequestCleanStatusError extends Error {}
export class ReleasePullRequestNotFoundError extends Error {}

export type ApplyPullRequest = {
  readonly id: string;
  readonly title: string;
  readonly state: "OPEN" | "MERGED" | "CLOSED";
  readonly headSha: string;
  readonly mergeStateStatus: string;
  readonly ownership: ReleaseOwnership | undefined;
  readonly autoMerge:
    | { readonly mergeMethod: string; readonly enabledBy: string }
    | undefined;
};
export type ApplyGithub = {
  readPullRequest(): Promise<ApplyPullRequest>;
  listCheckRuns(sha: string): Promise<readonly SyntheticCheckRun[]>;
  createCheckRun(
    input: {
      name: string;
      headSha: string;
      externalId: string;
      detailsUrl: string;
    },
  ): Promise<SyntheticCheckRun>;
  completeCheckRun(
    id: number,
    conclusion: "success" | "neutral" | "cancelled",
  ): Promise<void>;
  disablePullRequestAutoMerge(id: string): Promise<void>;
  enablePullRequestAutoMerge(
    input: { id: string; mergeMethod: "REBASE"; expectedHeadOid: string },
  ): Promise<void>;
  fetchMainSha(): Promise<string>;
  deleteReleaseBranchWithLease(
    branch: string,
    sha: string,
  ): Promise<"deleted" | "missing" | "lease-mismatch">;
  closePullRequest(id: string): Promise<void>;
};
export type ApplyClock = {
  now(): number;
  sleep(milliseconds: number): Promise<void>;
};
export type PublishTagApplyInput = {
  readonly runId: string;
  readonly runAttempt: string;
  readonly bundleDigest: string;
  readonly releaseSha: string;
  readonly selectedSha: string;
  readonly ownership: ReleaseOwnership;
  readonly detailsUrl: string;
};
export type ApplyOutcome = "merged" | "source-first-collision";
