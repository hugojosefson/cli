import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
import {
  makeTempDir,
  readTextFile,
  remove,
  writeTextFile,
} from "../testing/files-test-fixtures.ts";
import { runRawCommand } from "../runtime/command.ts";
import { assertEquals, assertStringIncludes } from "@std/assert";
import { githubCiDependencySummary } from "./github-ci-dependency-summary.ts";
const test = trackTests(import.meta.url, nativeTest);
const head = "a".repeat(40);
const record = {
  number: 128,
  state: "OPEN",
  isCrossRepository: false,
  headRefName: "hj/deps",
  url: "https://github.com/example/repo/pull/128",
  headRefOid: head,
};

const commands = `set -euo pipefail
git() { printf '%s\\n' "\${EXPECTED_HEAD}"; }
sleep() { printf '%s\\n' "$1" >> "\${STATE}/waits"; }
gh() {
  if [ "$1 $2" = "run list" ]; then
    local runs
    runs="$(cat "\${STATE}/runs")"
    runs="$((runs + 1))"
    printf '%s\\n' "\${runs}" > "\${STATE}/runs"
    if [ "\${runs}" -lt "\${RUN_AFTER}" ]; then
      printf '[]'
    else
      printf '%s\\n' "\${RUN_DATA}"
    fi
    return 0
  fi
  test "$1 $2" = "pr view"
  local count
  count="$(cat "\${STATE}/count")"
  count="$((count + 1))"
  printf '%s\\n' "\${count}" > "\${STATE}/count"
  if [ "\${count}" -lt "\${READY_AFTER}" ]; then
    if [ "\${MODE}" = "error" ]; then
      return 1
    fi
    printf '%s\\n' "\${STALE_DATA}"
    return 0
  fi
  printf '%s\\n' "\${CURRENT_DATA}"
}
`;

async function attempt(
  readyAfter: number,
  mode: string,
  change = {},
  runAfter = 1,
  runChange = {},
) {
  const root = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-ci-retry-",
  });
  try {
    await writeTextFile(`${root}/count`, "0");
    await writeTextFile(`${root}/runs`, "0");
    await writeTextFile(`${root}/summary`, "");
    await writeTextFile(`${root}/waits`, "");
    const result = await runRawCommand("sh", {
      args: [
        "-c",
        'exec bash -c "$1"',
        "retry",
        commands + githubCiDependencySummary,
      ],
      env: {
        branch: "hj/deps",
        EXPECTED_HEAD: head,
        STATE: root,
        READY_AFTER: String(readyAfter),
        MODE: mode,
        GITHUB_STEP_SUMMARY: `${root}/summary`,
        RUN_AFTER: String(runAfter),
        RUN_DATA: JSON.stringify([{
          event: "pull_request",
          headSha: head,
          status: "completed",
          conclusion: "action_required",
          url: "https://github.com/example/repo/actions/runs/123",
          ...runChange,
        }]),
        STALE_DATA: JSON.stringify({ ...record, headRefOid: "c".repeat(40) }),
        CURRENT_DATA: JSON.stringify({ ...record, ...change }),
      },
    });
    return {
      success: result.success,
      output: new TextDecoder().decode(result.stdout),
      error: new TextDecoder().decode(result.stderr),
      summary: await readTextFile(`${root}/summary`),
      runs: Number(await readTextFile(`${root}/runs`)),
      queries: Number(await readTextFile(`${root}/count`)),
      waits: (await readTextFile(`${root}/waits`)).trim().split("\n").filter(
        Boolean,
      ),
    };
  } finally {
    await remove(root, { recursive: true });
  }
}

test("dependency CI waits for the pushed PR commit", async () => {
  for (const mode of ["stale", "error"]) {
    const result = await attempt(3, mode);
    assertEquals(result.success, true);
    assertEquals(result.queries, 3);
    assertEquals(result.waits, ["2", "2"]);
    assertStringIncludes(result.summary, `Commit: ${head}`);
    assertStringIncludes(
      result.summary,
      "https://github.com/example/repo/pull/128",
    );
    assertStringIncludes(result.summary, "User approval is necessary");
  }
});

test("dependency CI stops after ten incorrect PR responses", async () => {
  for (
    const change of [
      { headRefOid: "c".repeat(40) },
      { state: "CLOSED" },
      { isCrossRepository: true },
      { headRefName: "other" },
      { url: null },
    ]
  ) {
    const result = await attempt(1, "stale", change);
    assertEquals(result.success, false);
    assertEquals(result.queries, 10);
    assertEquals(result.waits, Array(9).fill("2"));
    assertEquals(result.output, "");
    assertStringIncludes(result.error, "after 10 attempts");
  }
});

test("dependency CI waits for the PR workflow", async () => {
  const result = await attempt(1, "stale", {}, 3);
  assertEquals(result.success, true);
  assertEquals(result.runs, 3);
  assertEquals(result.waits, ["3", "3"]);
  assertStringIncludes(
    result.summary,
    "https://github.com/example/repo/actions/runs/123",
  );
});

test("dependency CI reports approval only when necessary", async () => {
  for (
    const [status, conclusion] of [["queued", ""], ["in_progress", null], [
      "completed",
      "success",
    ]]
  ) {
    const result = await attempt(1, "stale", {}, 1, { status, conclusion });
    assertEquals(result.success, true);
    assertStringIncludes(
      result.summary,
      `Workflow status: ${conclusion || status}`,
    );
    assertEquals(result.summary.includes("User approval is necessary"), false);
  }
});

test("dependency CI rejects missing or unrelated workflows after ten attempts", async () => {
  for (
    const [runAfter, runChange] of [
      [11, {}],
      [1, { headSha: "c".repeat(40) }],
      [1, { event: "workflow_dispatch" }],
    ] as const
  ) {
    const result = await attempt(1, "stale", {}, runAfter, runChange);
    assertEquals(result.success, false);
    assertEquals(result.runs, 10);
    assertEquals(result.waits, Array(9).fill("3"));
    assertStringIncludes(result.summary, "Examine the PR checks.");
  }
});
