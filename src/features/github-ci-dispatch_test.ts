import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import { assertEquals, assertStringIncludes } from "@std/assert";
import { parse } from "yaml";
import { githubCiArtifacts } from "./github-ci-artifacts.ts";
import { githubCiRuntimeMatrix } from "./github-ci-runtime-matrix.ts";

test("CI uses PR commits and read-only permissions", () => {
  for (
    const content of [
      githubCiArtifacts[0].content,
      githubCiRuntimeMatrix(githubCiArtifacts[0].content),
    ]
  ) {
    const workflow = parse(content);
    assertEquals(workflow.permissions, {
      contents: "read",
      "pull-requests": "read",
    });
    assertEquals(Object.keys(workflow.on.workflow_dispatch.inputs), [
      "pull_request",
      "base_sha",
      "head_sha",
    ]);
    for (
      const job of Object.values(workflow.jobs) as {
        steps: { name?: string; run?: string; uses?: string }[];
      }[]
    ) {
      const guard = job.steps.findIndex((step) =>
        step.name === "Validate pull request inputs"
      );
      const checkout = job.steps.findIndex((step) =>
        step.uses?.startsWith("actions/checkout@")
      );
      assertEquals(guard >= 0 && guard < checkout, true);
      assertStringIncludes(
        job.steps[guard].run!,
        ".headRefOid == $head and .baseRefOid == $base and .headRefName == $ref",
      );
    }
  }
});

test("dependency PR creation and updates start CI", () => {
  const workflow = parse(githubCiArtifacts[1].content);
  assertEquals(workflow.permissions.actions, "write");
  const command = workflow.jobs.update.steps.at(-1).run as string;
  assertStringIncludes(command, "deno task update-dependencies");
  assertStringIncludes(command, "deno outdated --recursive --update --latest");
  assertStringIncludes(command, 'gh workflow run hj-ci.yaml --ref "${branch}"');
  assertEquals(
    command.indexOf("gh workflow run") > command.indexOf("gh pr create"),
    true,
  );
  assertStringIncludes(command, '--field head_sha="${head_sha}"');
});

test("CI rejects changed PR data before checkout", async () => {
  const { runRawCommand } = await import("../runtime/command.ts");
  const workflow = parse(githubCiArtifacts[0].content);
  const guard = workflow.jobs.check.steps[0].run;
  const head = "a".repeat(40);
  const base = "b".repeat(40);
  const record = {
    state: "OPEN",
    isCrossRepository: false,
    headRefName: "hj/deps",
    headRefOid: head,
    baseRefOid: base,
  };
  const environment = {
    PR_NUMBER: "12",
    HEAD_SHA: head,
    BASE_SHA: base,
    RUN_SHA: head,
    RUN_REF: "hj/deps",
  };
  for (
    const [change, variables, success] of [
      [{}, {}, true],
      [{ headRefOid: "c".repeat(40) }, {}, false],
      [{ baseRefOid: "c".repeat(40) }, {}, false],
      [{ state: "CLOSED" }, {}, false],
      [{ isCrossRepository: true }, {}, false],
      [{ headRefName: "other" }, {}, false],
      [{}, { RUN_SHA: "c".repeat(40) }, false],
      [{}, { PR_NUMBER: "12;exit 0" }, false],
      [{}, { BASE_SHA: "invalid" }, false],
    ] as const
  ) {
    const result = await runRawCommand("sh", {
      args: [
        "-c",
        'exec bash -c "$1"',
        "guard",
        `gh() { printf '%s\\n' "\${PR_DATA}"; }\n${guard}`,
      ],
      env: {
        ...environment,
        ...variables,
        PR_DATA: JSON.stringify({ ...record, ...change }),
      },
    });
    assertEquals(result.success, success);
  }
});
