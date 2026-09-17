import { test as nativeTest } from "node:test";
import { assertEquals, assertStringIncludes } from "@std/assert";
import { parse } from "yaml";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
import { inspectArtifact } from "../artifacts/inspect-artifact.ts";
import { describeFileRepair } from "../cli/describe-file-repair.ts";
import { githubCiArtifacts } from "./github-ci-artifacts.ts";
import { githubCiRuntimeMatrix } from "./github-ci-runtime-matrix.ts";
import {
  publishGithubArtifact,
  publishJsrArtifact,
  publishNpmArtifact,
  publishTagArtifact,
} from "./github-release-publish-artifacts.ts";

const test = trackTests(import.meta.url, nativeTest);
type Job = {
  "cache-mode"?: string;
  steps: { uses?: string; with?: Record<string, unknown> }[];
};

test("PR jobs have read-only cache access", () => {
  for (
    const content of [
      githubCiArtifacts[0].content,
      githubCiRuntimeMatrix(githubCiArtifacts[0].content),
    ]
  ) {
    const workflow = parse(content);
    assertEquals(Object.keys(workflow.on), [
      "pull_request",
    ]);
    assertEquals(workflow["cache-mode"], "read");
    for (const job of Object.values(workflow.jobs) as Job[]) {
      assertEquals(job["cache-mode"], undefined);
      for (const step of job.steps) {
        assertEquals(step.uses?.startsWith("actions/cache@") ?? false, false);
        assertEquals(
          step.uses?.startsWith("actions/cache/save@") ?? false,
          false,
        );
      }
    }
    if (workflow.jobs.native) {
      assertEquals(
        workflow.jobs.native.steps.some((step: { uses?: string }) =>
          step.uses?.startsWith("actions/cache/restore@")
        ),
        true,
      );
    }
  }
});

test("cache writers use the default Git branch", () => {
  const update = parse(githubCiArtifacts[1].content);
  assertEquals(Object.keys(update.on), ["schedule", "workflow_dispatch"]);
  assertEquals(update["cache-mode"], "read");
  assertEquals(
    update.jobs.update.steps[0].with.ref,
    "${{ github.sha }}",
  );
  const tag = parse(publishTagArtifact.content);
  assertEquals(Object.keys(tag.on), ["push", "workflow_dispatch"]);
  assertEquals(tag.on.push.branches, ["main"]);
  assertEquals(tag["cache-mode"], "read");
  assertEquals(tag.jobs["publish-tag-prepare"]["cache-mode"], "write");
  assertEquals(tag.jobs["publish-tag-prepare"].steps[0].with.ref, "main");
  assertEquals(tag.jobs["publish-tag-apply"]["cache-mode"], undefined);
});

test("publication jobs cannot write caches", () => {
  for (
    const artifact of [
      publishJsrArtifact,
      publishNpmArtifact,
      publishGithubArtifact,
    ]
  ) {
    const workflow = parse(artifact.content);
    assertEquals(workflow["cache-mode"], "read");
    for (const job of Object.values(workflow.jobs) as Job[]) {
      assertEquals(job["cache-mode"], undefined);
    }
  }
});

test("cache policy repair identifies the incorrect access value", () => {
  const artifact = githubCiArtifacts[0];
  const content = artifact.content.replace(
    "cache-mode: read",
    "cache-mode: write",
  );
  const inspection = inspectArtifact(
    { kind: "file", ...artifact, mode: 0o644 },
    { kind: "file", content, mode: 0o644, digest: "test" },
  );
  assertEquals(inspection.result, "differs");
  const details = describeFileRepair(artifact.path, content, artifact.content)
    .join("\n");
  assertStringIncludes(details, "cache-mode");
  assertStringIncludes(details, "read");
});
