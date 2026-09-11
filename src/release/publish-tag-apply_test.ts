import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { cleanStatusRecovery } from "./apply-cleanup.ts";
import { expectedChecks } from "./apply-checks.ts";
import { ReleasePullRequestNotFoundError } from "./apply-types.ts";
import { applyPublishTag } from "./publish-tag-apply.ts";
import {
  type ApplyGithub,
  type ApplyPullRequest,
  ReleaseApplyConflictError,
  ReleaseApplyError,
  ReleaseApplyTimeoutError,
} from "./apply-types.ts";
import { recoverPublishedTag } from "./publish-tag-recovery.ts";
import { publishTagApply } from "./publish-tag-orchestration.ts";
import {
  encodeReleaseBundle,
  type ReleaseBundle,
  releaseBundleSchema,
} from "./release-bundle.ts";
import type { ReleaseOwnership } from "./release-pr.ts";
import {
  classifyReleaseCheck,
  parseReleaseCheckExternalId,
  releaseCheckExternalId,
  releaseCheckIntegrationId,
  type SyntheticCheckRun,
} from "./synthetic-check.ts";

const sha = "a".repeat(40);
const digest = "b".repeat(64);
const ownership: ReleaseOwnership = {
  schema: releaseBundleSchema,
  selectedSha: "c".repeat(40),
  version: "1.2.3",
  branchHead: sha,
  treeDigest: "d".repeat(64),
};
const input = {
  runId: "12",
  runAttempt: "3",
  bundleDigest: digest,
  releaseSha: sha,
  selectedSha: ownership.selectedSha,
  ownership,
  detailsUrl: "https://example.test/actions/runs/12",
};

class Clock {
  time = 0;
  onSleep: (() => void) | undefined;
  now() {
    return this.time;
  }
  sleep(milliseconds: number) {
    this.time += milliseconds;
    this.onSleep?.();
    return Promise.resolve();
  }
}
class Github implements ApplyGithub {
  pr: ApplyPullRequest = {
    id: "PR",
    title: "chore(release): 1.2.3",
    state: "OPEN",
    headSha: sha,
    mergeStateStatus: "BLOCKED",
    ownership,
    autoMerge: undefined,
  };
  runs: SyntheticCheckRun[] = [];
  main = ownership.selectedSha;
  calls: string[] = [];
  nextId = 1;
  readPullRequest() {
    return Promise.resolve(this.pr);
  }
  listCheckRuns() {
    return Promise.resolve(this.runs);
  }
  createCheckRun(
    value: {
      name: string;
      headSha: string;
      externalId: string;
      detailsUrl: string;
    },
  ) {
    this.calls.push(`create:${value.name}`);
    const run: SyntheticCheckRun = {
      id: this.nextId++,
      ...value,
      integrationId: releaseCheckIntegrationId,
      status: "in_progress",
      conclusion: null,
    };
    this.runs.push(run);
    return Promise.resolve(run);
  }
  completeCheckRun(
    id: number,
    conclusion: "success" | "neutral" | "cancelled",
  ) {
    this.calls.push(`complete:${conclusion}`);
    this.runs = this.runs.map((run) =>
      run.id === id ? { ...run, status: "completed", conclusion } : run
    );
    return Promise.resolve();
  }
  disablePullRequestAutoMerge() {
    this.calls.push("disable");
    this.pr = { ...this.pr, autoMerge: undefined };
    return Promise.resolve();
  }
  enablePullRequestAutoMerge(
    value: { mergeMethod: "REBASE"; expectedHeadOid: string },
  ) {
    this.calls.push(`enable:${value.mergeMethod}:${value.expectedHeadOid}`);
    this.pr = {
      ...this.pr,
      autoMerge: {
        mergeMethod: value.mergeMethod,
        enabledBy: { login: "github-actions", type: "Bot" },
      },
    };
    return Promise.resolve();
  }
  fetchMainSha() {
    return Promise.resolve(this.main);
  }
  deleteReleaseBranchWithLease() {
    this.calls.push("delete-branch");
    return Promise.resolve("deleted" as const);
  }
  closePullRequest() {
    this.calls.push("close");
    this.pr = { ...this.pr, state: "CLOSED" };
    return Promise.resolve();
  }
}

Deno.test("synthetic external IDs are canonical and malformed prefixed IDs conflict", () => {
  const externalId = releaseCheckExternalId({ ...input, context: "check" });
  assertEquals(externalId, `hjrc/1/12/3/check/${digest}/${sha}`);
  assertEquals(parseReleaseCheckExternalId(externalId)?.context, "check");
  assertThrows(
    () => parseReleaseCheckExternalId(`hjrc/1/012/3/check/${digest}/${sha}`),
    TypeError,
  );
  assertEquals(parseReleaseCheckExternalId("foreign"), undefined);
});

Deno.test("check classification distinguishes current, old, and different data", () => {
  const current = { ...input, context: "check" as const };
  const run = (externalId: string): SyntheticCheckRun => ({
    id: 1,
    name: "check",
    headSha: sha,
    integrationId: releaseCheckIntegrationId,
    externalId,
    detailsUrl: input.detailsUrl,
    status: "in_progress",
    conclusion: null,
  });
  assertEquals(
    classifyReleaseCheck(run(releaseCheckExternalId(current)), current),
    "current",
  );
  assertEquals(
    classifyReleaseCheck(
      run(releaseCheckExternalId({ ...current, runAttempt: "4" })),
      current,
    ),
    "older",
  );
  assertEquals(
    classifyReleaseCheck(
      run(releaseCheckExternalId({ ...current, bundleDigest: "e".repeat(64) })),
      current,
    ),
    "different",
  );
});

Deno.test("apply blocks, neutralizes older checks, enables exact rebase, and waits for merge", async () => {
  const github = new Github();
  const clock = new Clock();
  github.runs.push({
    id: 99,
    name: "check",
    headSha: sha,
    integrationId: releaseCheckIntegrationId,
    externalId: releaseCheckExternalId({
      ...input,
      runAttempt: "2",
      context: "check",
    }),
    detailsUrl: input.detailsUrl,
    status: "in_progress",
    conclusion: null,
  });
  clock.onSleep = () => {
    if (clock.time >= 10_000) github.pr = { ...github.pr, state: "MERGED" };
  };
  assertEquals(await applyPublishTag(github, clock, input), "merged");
  assertEquals(github.calls, [
    "create:check",
    "create:hj-release-commit-validation",
    "complete:neutral",
    `enable:REBASE:${sha}`,
    "complete:success",
    "complete:success",
  ]);
});

Deno.test("apply disables only an exact prior request and rejects another merge method", async () => {
  const github = new Github();
  const clock = new Clock();
  github.pr = {
    ...github.pr,
    autoMerge: {
      mergeMethod: "SQUASH",
      enabledBy: { login: "github-actions", type: "Bot" },
    },
  };
  await assertRejects(
    () => applyPublishTag(github, clock, input),
    ReleaseApplyConflictError,
  );
  assertEquals(github.calls, []);
});

Deno.test("apply validates route fields before GitHub effects", async () => {
  const github = new Github();
  await assertRejects(
    () => applyPublishTag(github, new Clock(), { ...input, runId: "01" }),
    TypeError,
  );
  assertEquals(github.calls, []);
});

Deno.test("apply rejects malformed older owned checks without changing them", async () => {
  const github = new Github();
  const older: SyntheticCheckRun = {
    id: 99,
    name: "check",
    headSha: sha,
    integrationId: null,
    externalId: releaseCheckExternalId({
      ...input,
      runAttempt: "2",
      context: "check",
    }),
    detailsUrl: input.detailsUrl,
    status: "in_progress",
    conclusion: null,
  };
  github.runs.push(older);
  await assertRejects(
    () => applyPublishTag(github, new Clock(), input),
    ReleaseApplyConflictError,
  );
  assertEquals(github.runs.find((run) => run.id === older.id), older);
});

Deno.test("apply retries read errors but treats malformed reads as conflicts", async () => {
  class ReadErrors extends Github {
    failures: ("error" | "malformed")[] = [];
    override listCheckRuns() {
      const failure = this.failures.shift();
      if (failure === "error") return Promise.reject(new Error("read"));
      if (failure === "malformed") return Promise.reject(new TypeError("bad"));
      return super.listCheckRuns();
    }
  }
  const retried = new ReadErrors();
  const retryClock = new Clock();
  retried.failures.push("error");
  retryClock.onSleep = () => {
    if (retryClock.time >= 10_000) {
      retried.pr = { ...retried.pr, state: "MERGED" };
    }
  };
  assertEquals(await applyPublishTag(retried, retryClock, input), "merged");
  assertEquals(retryClock.time >= 5_000, true);

  const malformed = new ReadErrors();
  const malformedClock = new Clock();
  malformed.failures.push("malformed");
  await assertRejects(
    () => applyPublishTag(malformed, malformedClock, input),
    ReleaseApplyConflictError,
  );
  assertEquals(malformedClock.time, 0);
});

Deno.test("apply resumes at an already merged owned pull request", async () => {
  const github = new Github();
  github.pr = { ...github.pr, state: "MERGED" };
  assertEquals(await applyPublishTag(github, new Clock(), input), "merged");
  assertEquals(github.calls, []);
});

Deno.test("apply uses source-first cleanup with a branch lease", async () => {
  class SourceChangesAfterChecks extends Github {
    override completeCheckRun(
      id: number,
      conclusion: "success" | "neutral" | "cancelled",
    ) {
      this.main = "e".repeat(40);
      return super.completeCheckRun(id, conclusion);
    }
  }
  const github = new SourceChangesAfterChecks();
  const clock = new Clock();
  assertEquals(
    await applyPublishTag(github, clock, input),
    "source-first-collision",
  );
  assertEquals(github.calls.slice(-3), ["disable", "delete-branch", "close"]);
});

Deno.test("source-first cleanup revalidates ownership before mutation", async () => {
  class ChangedOwnership extends Github {
    override fetchMainSha() {
      this.pr = { ...this.pr, ownership: undefined };
      return Promise.resolve("e".repeat(40));
    }
  }
  const github = new ChangedOwnership();
  await assertRejects(
    () => applyPublishTag(github, new Clock(), input),
    ReleaseApplyConflictError,
  );
  assertEquals(
    github.calls.some((call) =>
      call === "disable" || call === "delete-branch" || call === "close"
    ),
    false,
  );
});

Deno.test("apply removes a stale release before creating checks or auto-merge", async () => {
  const github = new Github();
  github.main = "e".repeat(40);
  github.pr = { ...github.pr, mergeStateStatus: "BEHIND" };
  assertEquals(
    await applyPublishTag(github, new Clock(), input),
    "source-first-collision",
  );
  assertEquals(github.calls, ["delete-branch", "close"]);
});

Deno.test("apply cancels owned checks when source changes while waiting for blocked status", async () => {
  const github = new Github();
  const clock = new Clock();
  github.pr = { ...github.pr, mergeStateStatus: "UNKNOWN" };
  clock.onSleep = () => {
    github.main = "e".repeat(40);
    github.pr = { ...github.pr, mergeStateStatus: "BEHIND" };
  };
  assertEquals(
    await applyPublishTag(github, clock, input),
    "source-first-collision",
  );
  assertEquals(github.runs.map((run) => run.conclusion), [
    "cancelled",
    "cancelled",
  ]);
  assertEquals(github.calls.slice(-2), ["delete-branch", "close"]);
  assertEquals(github.calls.some((call) => call.startsWith("enable:")), false);
});

Deno.test("early collision preserves a foreign auto-merge request", async () => {
  const github = new Github();
  github.main = "e".repeat(40);
  github.pr = {
    ...github.pr,
    autoMerge: {
      mergeMethod: "REBASE",
      enabledBy: { type: "User", login: "owner" },
    },
  };
  await assertRejects(
    () => applyPublishTag(github, new Clock(), input),
    ReleaseApplyConflictError,
  );
  assertEquals(github.calls, []);
});

Deno.test("apply timeout disables the exact request but does not merge", async () => {
  const github = new Github();
  const clock = new Clock();
  await assertRejects(
    () => applyPublishTag(github, clock, input),
    ReleaseApplyTimeoutError,
  );
  assertEquals(github.calls.at(-1), "disable");
});

Deno.test("apply rejects a pull request closed during the wait loop", async () => {
  const github = new Github();
  const clock = new Clock();
  clock.onSleep = () => {
    if (clock.time >= 10_000) github.pr = { ...github.pr, state: "CLOSED" };
  };
  await assertRejects(
    () => applyPublishTag(github, clock, input),
    ReleaseApplyError,
  );
  assertEquals(github.calls.at(-1), "disable");
});

Deno.test("apply rejects an exact auto-merge request disappearing while waiting", async () => {
  const github = new Github();
  const clock = new Clock();
  clock.onSleep = () => {
    if (clock.time >= 10_000) {
      github.pr = { ...github.pr, autoMerge: undefined };
    }
  };
  await assertRejects(
    () => applyPublishTag(github, clock, input),
    ReleaseApplyConflictError,
  );
  assertEquals(github.calls.includes("disable"), false);
});

Deno.test("error cleanup rereads ownership before disabling auto-merge", async () => {
  const clock = new Clock();
  class OwnershipChangesDuringCleanup extends Github {
    readsAtRequestLimit = 0;
    cleanupStarted = false;
    changed = false;
    override readPullRequest() {
      if (clock.time >= 60_000 && ++this.readsAtRequestLimit === 2) {
        this.cleanupStarted = true;
      }
      return super.readPullRequest();
    }
    override listCheckRuns() {
      const result = super.listCheckRuns();
      if (this.cleanupStarted && !this.changed) {
        this.changed = true;
        this.pr = { ...this.pr, ownership: undefined };
      }
      return result;
    }
    override completeCheckRun(
      id: number,
      conclusion: "success" | "neutral" | "cancelled",
    ) {
      if (conclusion === "success") {
        this.calls.push(`complete:${conclusion}`);
        return Promise.resolve();
      }
      return super.completeCheckRun(id, conclusion);
    }
  }
  const github = new OwnershipChangesDuringCleanup();
  await assertRejects(
    () => applyPublishTag(github, clock, input),
    ReleaseApplyConflictError,
  );
  assertEquals(github.calls.includes("disable"), false);
  assertEquals(github.calls.includes("complete:cancelled"), true);
});

Deno.test("apply reports failed synthetic-run cleanup", async () => {
  class FailedCheckCleanup extends Github {
    override completeCheckRun(
      id: number,
      conclusion: "success" | "neutral" | "cancelled",
    ) {
      this.calls.push(`complete:${conclusion}`);
      if (conclusion !== "success") {
        return super.completeCheckRun(id, conclusion);
      }
      return Promise.resolve();
    }
  }
  const github = new FailedCheckCleanup();
  await assertRejects(
    () => applyPublishTag(github, new Clock(), input),
    ReleaseApplyTimeoutError,
  );
  assertEquals(github.calls.at(-1), "complete:cancelled");
});

Deno.test("recovery retries a tag push read, deletes only an owned branch, then emits event", async () => {
  let tag: string | undefined;
  let branch: string | undefined = sha;
  const events: unknown[] = [];
  await recoverPublishedTag({
    readTag: () => Promise.resolve(tag),
    pushLightweightTag: () => {
      tag = sha;
      return Promise.reject(new Error("uncertain"));
    },
    readReleaseBranch: () => Promise.resolve(branch),
    mergedPullRequestsForReleaseBranch: () => Promise.resolve([{ ownership }]),
    deleteReleaseBranchWithLease: () => {
      branch = undefined;
      return Promise.resolve("deleted" as const);
    },
    sendSuccessEvent: (event) => {
      events.push(event);
      return Promise.resolve();
    },
  }, { version: "1.2.3", releaseSha: sha, ownership });
  assertEquals(events, [{
    schema: 1,
    version: "1.2.3",
    tag: "1.2.3",
    releaseSha: sha,
  }]);
});

Deno.test("recovery emits an event when the release branch is already absent", async () => {
  const events: unknown[] = [];
  let deletes = 0;
  await recoverPublishedTag({
    readTag: () => Promise.resolve(sha),
    pushLightweightTag: () => Promise.resolve(),
    readReleaseBranch: () => Promise.resolve(undefined),
    mergedPullRequestsForReleaseBranch: () => {
      throw new Error("history must not be read");
    },
    deleteReleaseBranchWithLease: () => {
      deletes++;
      return Promise.resolve("deleted" as const);
    },
    sendSuccessEvent: (event) => {
      events.push(event);
      return Promise.resolve();
    },
  }, { version: "1.2.3", releaseSha: sha, ownership });
  assertEquals(deletes, 0);
  assertEquals(events.length, 1);
});

Deno.test("recovery rejects a release branch lease mismatch without an event", async () => {
  let events = 0;
  await assertRejects(
    () =>
      recoverPublishedTag({
        readTag: () => Promise.resolve(sha),
        pushLightweightTag: () => Promise.resolve(),
        readReleaseBranch: () => Promise.resolve(sha),
        mergedPullRequestsForReleaseBranch: () =>
          Promise.resolve([{ ownership }]),
        deleteReleaseBranchWithLease: () =>
          Promise.resolve("lease-mismatch" as const),
        sendSuccessEvent: () => {
          events++;
          return Promise.resolve();
        },
      }, { version: "1.2.3", releaseSha: sha, ownership }),
    ReleaseApplyConflictError,
  );
  assertEquals(events, 0);
});

Deno.test("recovery accepts a missing delete result after confirming branch absence", async () => {
  let branch: string | undefined = sha;
  let deletes = 0;
  let events = 0;
  await recoverPublishedTag({
    readTag: () => Promise.resolve(sha),
    pushLightweightTag: () => Promise.resolve(),
    readReleaseBranch: () => Promise.resolve(branch),
    mergedPullRequestsForReleaseBranch: () => Promise.resolve([{ ownership }]),
    deleteReleaseBranchWithLease: () => {
      deletes++;
      branch = undefined;
      return Promise.resolve("missing" as const);
    },
    sendSuccessEvent: () => {
      events++;
      return Promise.resolve();
    },
  }, { version: "1.2.3", releaseSha: sha, ownership });
  assertEquals({ deletes, events, branch }, {
    deletes: 1,
    events: 1,
    branch: undefined,
  });
});

Deno.test("recovery rejects ambiguous reserved pull-request history", async () => {
  await assertRejects(
    () =>
      recoverPublishedTag({
        readTag: () => Promise.resolve(sha),
        pushLightweightTag: () => Promise.resolve(),
        readReleaseBranch: () => Promise.resolve(sha),
        mergedPullRequestsForReleaseBranch: () =>
          Promise.resolve([{ ownership }, { ownership: undefined }]),
        deleteReleaseBranchWithLease: () => Promise.resolve("deleted" as const),
        sendSuccessEvent: () => Promise.resolve(),
      }, { version: "1.2.3", releaseSha: sha, ownership }),
    ReleaseApplyConflictError,
  );
});

Deno.test("orchestration rejects an invalid environment bundle before injected effects", async () => {
  let called = false;
  const environment = {
    get: (name: string) =>
      name === "HJ_RELEASE_BUNDLE"
        ? "bad"
        : name === "HJ_RELEASE_BUNDLE_DIGEST"
        ? digest
        : "usual",
  };
  await assertRejects(() =>
    publishTagApply(
      new URL("file:///tmp/opencode/release-test/"),
      environment,
      {
        run: () => {
          called = true;
          return Promise.reject(new Error("unexpected"));
        },
      },
      {} as never,
      new Clock(),
    )
  );
  assertEquals(called, false);
});

Deno.test("orchestration validates usual route metadata before process effects", async () => {
  const bundle: ReleaseBundle = {
    schema: releaseBundleSchema,
    previousTag: null,
    previousTagTarget: null,
    selectedSha: ownership.selectedSha,
    previousVersion: "1.2.2",
    nextVersion: "1.2.3",
    releaseType: "patch",
    versionFile: {
      path: "deno.json",
      previousDigest: "1".repeat(64),
      text: '{"version":"1.2.3"}\n',
      digest: "2".repeat(64),
    },
    changelog: {
      path: "CHANGELOG.md",
      previousDigest: null,
      offset: 0,
      insertion: "# Changelog\n",
      digest: "3".repeat(64),
    },
    changedPaths: ["deno.json", "CHANGELOG.md"],
    treeDigest: ownership.treeDigest,
  };
  const encoded = await encodeReleaseBundle(bundle);
  const values = new Map([
    ["HJ_RELEASE_ROUTE", "usual"],
    ["HJ_RELEASE_BUNDLE", encoded.bundle],
    ["HJ_RELEASE_BUNDLE_DIGEST", encoded.digest],
    ["GITHUB_RUN_ID", "01"],
    ["GITHUB_RUN_ATTEMPT", "1"],
    ["GITHUB_SERVER_URL", "https://github.com"],
    ["GITHUB_REPOSITORY", "owner/repo"],
  ]);
  let called = false;
  await assertRejects(() =>
    publishTagApply(
      new URL("file:///tmp/opencode/release-test/"),
      { get: (name) => values.get(name) },
      {
        run: () => {
          called = true;
          return Promise.reject(new Error("unexpected"));
        },
      },
      {} as never,
      new Clock(),
    )
  );
  assertEquals(called, false);
});

Deno.test("cleanup retries a temporary read and confirms an uncertain cancellation", async () => {
  const github = new Github();
  const clock = new Clock();
  for (const check of expectedChecks(input)) await github.createCheckRun(check);
  const foreign = { ...github.runs[0], id: 99, externalId: "another-workflow" };
  github.runs.push(foreign);
  let reads = 0;
  github.readPullRequest = () =>
    ++reads === 1
      ? Promise.reject(new Error("temporary network failure"))
      : Promise.resolve(github.pr);
  const complete = github.completeCheckRun.bind(github);
  github.completeCheckRun = async (id, conclusion) => {
    await complete(id, conclusion);
    throw new Error("response lost after cancellation");
  };
  await cleanStatusRecovery(github, clock, 120_000, input);
  assertEquals(clock.time, 5_000);
  assertEquals(github.runs.slice(0, 2).map((run) => run.conclusion), [
    "cancelled",
    "cancelled",
  ]);
  assertEquals(github.runs[2], foreign);
  assertEquals(github.calls.filter((call) => call.startsWith("complete:")), [
    "complete:cancelled",
    "complete:cancelled",
  ]);
});

Deno.test("cleanup stops on missing or malformed PRs and bounds unavailable reads", async () => {
  for (
    const error of [
      new ReleasePullRequestNotFoundError(),
      new TypeError("invalid response"),
      new Error("offline"),
    ]
  ) {
    const github = new Github();
    const clock = new Clock();
    github.readPullRequest = () => Promise.reject(error);
    await assertRejects(
      () => cleanStatusRecovery(github, clock, 10_000, input),
      error.constructor === Error
        ? ReleaseApplyTimeoutError
        : ReleaseApplyConflictError,
    );
    assertEquals(clock.time, error.constructor === Error ? 10_000 : 0);
    assertEquals(github.calls, []);
  }
});

Deno.test("cleanup preserves ambiguous synthetic checks", async () => {
  const github = new Github();
  const check = expectedChecks(input)[0];
  await github.createCheckRun(check);
  await github.createCheckRun(check);
  github.calls = [];
  await assertRejects(
    () => cleanStatusRecovery(github, new Clock(), 60_000, input),
    ReleaseApplyConflictError,
    "ambiguous",
  );
  assertEquals(github.calls, []);
  assertEquals(github.runs.every((run) => run.status === "in_progress"), true);
});

Deno.test("cleanup confirms auto-merge was disabled after a lost response", async () => {
  const github = new Github();
  const clock = new Clock();
  for (const check of expectedChecks(input)) await github.createCheckRun(check);
  await github.enablePullRequestAutoMerge({
    mergeMethod: "REBASE",
    expectedHeadOid: sha,
  });
  github.calls = [];
  const disable = github.disablePullRequestAutoMerge.bind(github);
  github.disablePullRequestAutoMerge = async () => {
    await disable();
    throw new Error("response lost after disabling auto-merge");
  };
  await cleanStatusRecovery(github, clock, 60_000, input);
  assertEquals(github.pr.autoMerge, undefined);
  assertEquals(github.calls, [
    "disable",
    "complete:cancelled",
    "complete:cancelled",
  ]);
  assertEquals(clock.time, 0);
});
