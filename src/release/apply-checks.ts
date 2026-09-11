/** Exact synthetic-check decisions, without GitHub effects. */
import {
  type PublishTagApplyInput,
  ReleaseApplyConflictError,
} from "./apply-types.ts";
import {
  assertExactCurrentCheck,
  parseReleaseCheckExternalId,
  releaseCheckContexts,
  releaseCheckExternalId,
  type SyntheticCheckRun,
} from "./synthetic-check.ts";
export function expectedChecks(input: PublishTagApplyInput) {
  return releaseCheckContexts.map((context) => ({
    name: context,
    headSha: input.releaseSha,
    externalId: releaseCheckExternalId({ ...input, context }),
    detailsUrl: input.detailsUrl,
  }));
}

export function exactCheck(
  runs: readonly SyntheticCheckRun[],
  check: {
    name: string;
    headSha: string;
    externalId: string;
    detailsUrl: string;
  },
  wanted: "in_progress" | "success",
): boolean {
  const matches = runs.filter((run) => run.externalId === check.externalId);
  if (matches.length > 1) {
    throw new ReleaseApplyConflictError("Synthetic check is ambiguous.");
  }
  if (matches.length !== 1) return false;
  const run = matches[0];
  try {
    assertExactCurrentCheck(
      run,
      parseReleaseCheckExternalId(check.externalId)!,
      check.detailsUrl,
    );
  } catch {
    throw new ReleaseApplyConflictError("Synthetic check differs.");
  }
  return wanted === "in_progress"
    ? run.status === "in_progress" && run.conclusion === null
    : run.status === "completed" && run.conclusion === "success";
}

export function exactCancelledCheck(
  runs: readonly SyntheticCheckRun[],
  check: ReturnType<typeof expectedChecks>[number],
): boolean {
  const matches = runs.filter((run) => run.externalId === check.externalId);
  if (matches.length !== 1) {
    throw new ReleaseApplyConflictError("Synthetic check is ambiguous.");
  }
  try {
    assertExactCurrentCheck(
      matches[0],
      parseReleaseCheckExternalId(check.externalId)!,
      check.detailsUrl,
    );
  } catch {
    throw new ReleaseApplyConflictError("Synthetic check differs.");
  }
  return matches[0].status === "completed" &&
    matches[0].conclusion === "cancelled";
}
