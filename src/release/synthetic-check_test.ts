import { assertThrows } from "@std/assert";
import {
  assertExactCurrentCheck,
  releaseCheckExternalId,
  releaseCheckIntegrationId,
  type SyntheticCheckRun,
} from "./synthetic-check.ts";

Deno.test("check ownership accepts GitHub's exact check URL but rejects other checks and repositories", () => {
  const expected = {
    runId: "12",
    runAttempt: "1",
    context: "check" as const,
    bundleDigest: "b".repeat(64),
    releaseSha: "a".repeat(40),
  };
  const url = "https://github.com/owner/repo/actions/runs/12";
  const run: SyntheticCheckRun = {
    id: 37,
    name: "check",
    headSha: expected.releaseSha,
    integrationId: releaseCheckIntegrationId,
    externalId: releaseCheckExternalId(expected),
    detailsUrl: "https://github.com/owner/repo/runs/37",
    status: "in_progress",
    conclusion: null,
  };
  assertExactCurrentCheck(run, expected, url);
  assertExactCurrentCheck({ ...run, detailsUrl: url }, expected, url);
  for (
    const detailsUrl of [
      "https://github.com/owner/repo/runs/38",
      "https://github.com/owner/other/runs/37",
      "https://example.test/owner/repo/runs/37",
      null,
    ]
  ) {
    assertThrows(() =>
      assertExactCurrentCheck({ ...run, detailsUrl }, expected, url)
    );
  }
  assertThrows(() =>
    assertExactCurrentCheck({ ...run, integrationId: 1 }, expected, url)
  );
  assertThrows(() =>
    assertExactCurrentCheck({ ...run, headSha: "c".repeat(40) }, expected, url)
  );
});
