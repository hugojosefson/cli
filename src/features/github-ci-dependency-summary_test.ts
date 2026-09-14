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

test("dependency updates report the PR workflow without approval permissions", () => {
  const workflow = parse(githubCiArtifacts[1].content);
  assertEquals(workflow.permissions.actions, "read");
  const command = workflow.jobs.update.steps.at(-1).run as string;
  assertStringIncludes(command, "deno task update-dependencies");
  assertStringIncludes(command, "deno outdated --recursive --update --latest");
  assertStringIncludes(
    command,
    "gh run list --workflow hj-ci.yaml --event pull_request",
  );
  assertEquals(
    command.indexOf("gh run list") > command.indexOf("gh pr create"),
    true,
  );
  assertEquals(command.includes("gh workflow run"), false);
  assertEquals(command.includes("/approve"), false);
  assertStringIncludes(command, "Approve workflows");
});
