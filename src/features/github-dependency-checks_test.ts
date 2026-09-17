import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
import { assertEquals } from "@std/assert";
import { makeTempDir, remove } from "../testing/files-test-fixtures.ts";
import { runRawCommand } from "../runtime/command.ts";
import { githubDependencyContext } from "./github-dependency-context.ts";
import { githubDependencyChecks } from "./github-dependency-checks.ts";
import { dependencyApiFixture } from "./github-dependency-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);

async function run(phase: string, data = {}, env = {}) {
  const root = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-deps-api-",
  });
  try {
    const result = await runRawCommand("sh", {
      args: [
        "-c",
        'exec python3 -c "$1"',
        "checks",
        dependencyApiFixture + githubDependencyContext +
        githubDependencyChecks +
        (phase === "cycle"
          ? '\nos.environ["PHASE"] = "report"\n' + githubDependencyContext +
            githubDependencyChecks
          : ""),
      ],
      env: {
        PHASE: phase === "cycle" ? "select" : phase,
        CASE: JSON.stringify(data),
        GITHUB_REPOSITORY: "owner/repo",
        GITHUB_REPOSITORY_ID: "1",
        GITHUB_RUN_ID: "2",
        GITHUB_RUN_ATTEMPT: "3",
        GITHUB_REF: "refs/heads/main",
        GITHUB_WORKFLOW_REF:
          "owner/repo/.github/workflows/hj-deps.yaml@refs/heads/main",
        GITHUB_WORKFLOW_SHA: "b".repeat(40),
        GITHUB_SHA: "b".repeat(40),
        HEAD_SHA: "a".repeat(40),
        BASE_SHA: "b".repeat(40),
        PR_NUMBER: "4",
        GITHUB_OUTPUT: `${root}/output`,
        GITHUB_STEP_SUMMARY: `${root}/summary`,
        ...env,
      },
    });
    const output = JSON.parse(new TextDecoder().decode(result.stdout));
    return { success: result.success, ...output };
  } finally {
    await remove(root, { recursive: true });
  }
}

test("dependency checks start after delayed PR data", async () => {
  const result = await run("select", { ready_after: 3 });
  assertEquals(result.success, true);
  assertEquals(result.writes.length, 2);
  assertEquals(
    result.checks.every((item: { status: string }) =>
      item.status === "in_progress"
    ),
    true,
  );
});

test("dependency checks report actual job results", async () => {
  const result = await run("report");
  assertEquals(result.success, true);
  assertEquals(
    result.writes.map((item: { body: unknown }) => item.body),
    Array(2).fill({ status: "completed", conclusion: "success" }),
  );
});

test("dependency checks reject changed or ambiguous identities", async () => {
  for (
    const data of [
      { base: "c".repeat(40) },
      { pr_count: 2 },
      { pr_count: 0 },
      { pr: { state: "closed" } },
      { pr: { user: { id: 7 } } },
      {
        pr: { head: { repo: { id: 8 }, ref: "hj/deps", sha: "a".repeat(40) } },
      },
      { run: { run_attempt: 2 } },
      { run: { workflow_id: 9 } },
      { run: { event: "pull_request" } },
      { run: { head_repository: { id: 8 } } },
      { run: { status: "completed", conclusion: "cancelled" } },
      { repository: { id: 8 } },
      { run: { path: ".github/workflows/other.yaml" } },
    ]
  ) {
    const result = await run("report", data);
    assertEquals(result.success, false, JSON.stringify(data));
    assertEquals(result.writes.length, 0);
  }
});

test("dependency checks reject untrusted workflow refs", async () => {
  for (
    const env of [{ GITHUB_REF: "refs/heads/hj/deps" }, {
      GITHUB_WORKFLOW_SHA: "c".repeat(40),
    }, {
      GITHUB_WORKFLOW_REF:
        "owner/repo/.github/workflows/hj-deps.yaml@refs/heads/hj/deps",
    }]
  ) {
    const result = await run("report", {}, env);
    assertEquals(result.success, false);
    assertEquals(result.writes.length, 0);
  }
});

test("dependency checks reject incorrect job inventories and previous attempts", async () => {
  for (
    const data of [
      { missing_job: true },
      { extra_job: 1 },
      { job: { name: "update" } },
      { job: { run_attempt: 2 } },
      { job: { run_id: 5 } },
      { job: { head_sha: "c".repeat(40) } },
    ]
  ) {
    const result = await run("report", data);
    assertEquals(result.success, false);
    assertEquals(result.writes.length, 0);
  }
});

test("dependency checks report failure for unsuccessful validation", async () => {
  for (
    const conclusion of [
      "failure",
      "cancelled",
      "skipped",
      "neutral",
      "timed_out",
      null,
    ]
  ) {
    const result = await run("report", { job: { conclusion } });
    assertEquals(result.success, false);
    assertEquals(
      result.writes.map((item: { body: unknown }) => item.body),
      Array(2).fill({ status: "completed", conclusion: "failure" }),
    );
  }
});

test("dependency checks change only unique owned checks", async () => {
  for (
    const data of [
      { checks: [{}] },
      { check_change: { external_id: "unrelated-job" } },
      { older: true },
      { check_change: { app: { id: 8 } } },
      { check_change: { details_url: "https://example.com" } },
      { extra_check: 1 },
      { check_change: { head_sha: "c".repeat(40) } },
    ]
  ) {
    const result = await run("report", data);
    assertEquals(result.success, false);
    assertEquals(result.writes.length, 0);
  }
});

test("dependency checks keep merger blocked before validation", async () => {
  const result = await run("select", { merge: "CLEAN" });
  assertEquals(result.success, false);
  assertEquals(
    result.checks.every((item: { status: string }) =>
      item.status === "in_progress"
    ),
    true,
  );
});

test("dependency checks reject skipped validation steps despite job success", async () => {
  const result = await run("report", { step: { conclusion: "skipped" } });
  assertEquals(result.success, false);
  assertEquals(
    result.writes.every((item: { body: { conclusion: string } }) =>
      item.body.conclusion === "failure"
    ),
    true,
  );
});

test("dependency checks continue after interrupted selection in an earlier attempt", async () => {
  for (const previous_checks of [1, 2]) {
    const result = await run("cycle", { previous_checks });
    assertEquals(result.success, true);
    assertEquals(
      result.checks.slice(0, previous_checks).every((
        item: { conclusion: string },
      ) => item.conclusion === "neutral"),
      true,
    );
    assertEquals(
      result.checks.slice(previous_checks).every((
        item: { conclusion: string },
      ) => item.conclusion === "success"),
      true,
    );
    assertEquals(
      result.writes.slice(0, 2).every((item: { body: { status: string } }) =>
        item.body.status === "in_progress"
      ),
      true,
    );
  }
});

test("dependency checks reject a base change after selection", async () => {
  const result = await run("cycle", { base_after_selection: true });
  assertEquals(result.success, false);
  assertEquals(result.writes.length, 2);
  assertEquals(
    result.checks.every((item: { status: string }) =>
      item.status === "in_progress"
    ),
    true,
  );
});

test("dependency checks keep merger blocked if the base changes between result writes", async () => {
  const result = await run("report", { base_after_success: true });
  assertEquals(result.success, false);
  assertEquals(result.writes.length, 1);
  assertEquals(result.checks[0].conclusion, "success");
  assertEquals(result.checks[1].status, "in_progress");
});

test("dependency checks also validate repositories without required checks", async () => {
  const result = await run("cycle", { unprotected: true, merge: "CLEAN" });
  assertEquals(result.success, true);
  assertEquals(result.calls.includes("graphql"), false);
  assertEquals(
    result.checks.every((item: { conclusion: string }) =>
      item.conclusion === "success"
    ),
    true,
  );
});

test("dependency checks examine required rules on subsequent API pages", async () => {
  const result = await run("select", { rules_pages: true, merge: "CLEAN" });
  assertEquals(result.success, false);
  assertEquals(result.calls.includes("graphql"), true);
});

test("dependency checks withhold validation outputs when earlier checks change merger to CLEAN", async () => {
  const result = await run("select", {
    previous_checks: 1,
    clean_after_retirement: true,
  });
  assertEquals(result.success, false);
  assertEquals(result.has_outputs, false);
});
