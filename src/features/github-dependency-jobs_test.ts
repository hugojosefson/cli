import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
import { assertEquals, assertStringIncludes } from "@std/assert";
import { parse } from "yaml";
import { githubCiArtifacts } from "./github-ci-artifacts.ts";
import { githubCiRuntimeMatrix } from "./github-ci-runtime-matrix.ts";
const test = trackTests(import.meta.url, nativeTest);

test("CI uses PR events and read-only permissions", () => {
  for (
    const content of [
      githubCiArtifacts[0].content,
      githubCiRuntimeMatrix(githubCiArtifacts[0].content),
    ]
  ) {
    const workflow = parse(content);
    assertEquals(workflow.permissions, { contents: "read" });
    assertEquals(Object.keys(workflow.on), ["pull_request"]);
    assertEquals(content.includes("inputs.head_sha"), false);
    assertEquals(content.includes("Validate pull request inputs"), false);
  }
});

test("dependency validation keeps checks permissions in isolated jobs", () => {
  const workflow = parse(githubCiArtifacts[1].content);
  assertEquals(workflow.permissions, { contents: "read" });
  assertEquals(workflow["cache-mode"], "read");
  for (const name of ["dependency-check", "dependency-source-validation"]) {
    const job = workflow.jobs[name];
    assertEquals(job.permissions, undefined);
    assertEquals(job["cache-mode"], undefined);
    assertEquals(job.steps[0].with.ref, "${{ needs.select.outputs.head }}");
    assertEquals(job.steps[0].with["persist-credentials"], false);
  }
  assertEquals(
    workflow.jobs["dependency-check"].steps.at(-1).run,
    "deno task all",
  );
  for (const name of ["select", "report"]) {
    const job = workflow.jobs[name];
    assertEquals(job.permissions, {
      contents: "read",
      actions: "read",
      "pull-requests": "read",
      checks: "write",
    });
    assertEquals(job.steps.length, 1);
    assertEquals(job.steps[0].uses, undefined);
    assertStringIncludes(job.steps[0].run, "GITHUB_WORKFLOW_SHA");
  }
  const command = workflow.jobs.update.steps.at(-1).run as string;
  assertStringIncludes(command, "deno task update-dependencies");
  assertStringIncludes(command, "deno outdated --recursive --update --latest");
  assertEquals(command.includes("[skip ci]"), false);
  assertEquals(command.includes("/approve"), false);
  assertEquals(workflow.jobs.update.steps[0].with.ref, "${{ github.sha }}");
});
