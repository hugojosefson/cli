/** Synthetic check identities used only by publish-tag-apply. */

export const releaseCheckIntegrationId = 15368;
export const releaseCheckContexts = [
  "check",
  "hj-release-commit-validation",
] as const;
export type ReleaseCheckContext = (typeof releaseCheckContexts)[number];
export type ParsedReleaseCheckId = {
  readonly runId: string;
  readonly runAttempt: string;
  readonly context: ReleaseCheckContext;
  readonly bundleDigest: string;
  readonly releaseSha: string;
};

const contextCodes: Record<ReleaseCheckContext, string> = {
  check: "check",
  "hj-release-commit-validation": "validation",
};
const idPattern =
  /^hjrc\/1\/([1-9][0-9]{0,19})\/([1-9][0-9]{0,9})\/(check|validation)\/([0-9a-f]{64})\/([0-9a-f]{40}|[0-9a-f]{64})$/;

export function releaseCheckExternalId(id: ParsedReleaseCheckId): string {
  const text = `hjrc/1/${id.runId}/${id.runAttempt}/${
    contextCodes[id.context]
  }/${id.bundleDigest}/${id.releaseSha}`;
  if (!idPattern.test(text) || text.length >= 200) {
    throw new TypeError("Invalid synthetic check external ID.");
  }
  return text;
}

/** Undefined means unowned; a malformed hjrc ID is deliberately an error. */
export function parseReleaseCheckExternalId(
  text: string,
): ParsedReleaseCheckId | undefined {
  if (!text.startsWith("hjrc/")) return undefined;
  const match = idPattern.exec(text);
  if (!match || text.length >= 200) {
    throw new TypeError("Malformed synthetic check external ID.");
  }
  const context = match[3] === "check"
    ? "check"
    : "hj-release-commit-validation";
  return {
    runId: match[1],
    runAttempt: match[2],
    context,
    bundleDigest: match[4],
    releaseSha: match[5],
  };
}

export type SyntheticCheckRun = {
  readonly id: number;
  readonly name: string;
  readonly headSha: string;
  readonly integrationId: number | null;
  readonly externalId: string | null;
  readonly detailsUrl: string | null;
  readonly status: "in_progress" | "completed" | string;
  readonly conclusion: "success" | "neutral" | "cancelled" | null | string;
};
export type CheckOwnership = "unowned" | "current" | "older" | "different";

export function classifyReleaseCheck(
  run: SyntheticCheckRun,
  current: ParsedReleaseCheckId,
): CheckOwnership {
  if (run.externalId === null) return "unowned";
  const parsed = parseReleaseCheckExternalId(run.externalId);
  if (!parsed) return "unowned";
  if (
    parsed.context !== current.context ||
    parsed.bundleDigest !== current.bundleDigest ||
    parsed.releaseSha !== current.releaseSha
  ) return "different";
  if (
    parsed.runId === current.runId && parsed.runAttempt === current.runAttempt
  ) return "current";
  return "older";
}

export function assertExactCurrentCheck(
  run: SyntheticCheckRun,
  expected: ParsedReleaseCheckId,
  detailsUrl?: string,
): void {
  if (
    classifyReleaseCheck(run, expected) !== "current" ||
    run.name !== expected.context || run.headSha !== expected.releaseSha ||
    run.integrationId !== releaseCheckIntegrationId ||
    detailsUrl !== undefined && !matchesCheckDetailsUrl(run, detailsUrl)
  ) {
    throw new TypeError("Synthetic check ownership is incorrect.");
  }
}

/** GitHub Actions replaces supplied details URLs with the check run's own URL. */
export function matchesCheckDetailsUrl(
  run: SyntheticCheckRun,
  workflowUrl: string,
): boolean {
  return run.detailsUrl === workflowUrl ||
    run.detailsUrl === workflowUrl.replace(
        /\/actions\/runs\/[1-9][0-9]*$/,
        `/runs/${run.id}`,
      );
}
