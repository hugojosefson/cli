import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import { assertEquals } from "@std/assert";
import type { ArtifactObservation } from "../api/artifact-inspection.ts";
import type { OperationContext } from "../api/repository-context.ts";
import { readmeStaticFeature } from "./readme-static-feature.ts";

function context(
  observation: ArtifactObservation,
  repair: OperationContext["repair"] = {
    kind: "features",
    featureIds: ["readme-static"],
  },
): OperationContext {
  return {
    repositoryRoot: new URL("file:///work/example/"),
    files: {
      observe: () => Promise.resolve(observation),
      exists: () => Promise.resolve(false),
      readText: () => Promise.resolve(undefined),
      readJson: () => Promise.resolve(undefined),
      digest: () => Promise.resolve(undefined),
      directoryStateDigest: () => Promise.resolve(undefined),
      mode: () => Promise.resolve(undefined),
    },
    git: {} as OperationContext["git"],
    detections: new Map(),
    requestedChanges: [],
    resolvedChanges: [],
    repair,
    options: {},
  };
}

test("readme-static preserves selected writable content", async () => {
  const drifted = context({
    kind: "file",
    content: "# edited\n",
    digest: "drift-digest",
    mode: 0o755,
  });
  const check = await readmeStaticFeature.checkEnable(drifted);
  assertEquals(check, {
    result: "no-op",
    reason: "README.md is already writable.",
    warnings: [],
  });
});

test("readme-static repairs explicitly selected non-writable content", async () => {
  const drifted = context({
    kind: "file",
    content: "# edited\n",
    digest: "drift-digest",
    mode: 0o440,
  });
  const check = await readmeStaticFeature.checkEnable(drifted);
  assertEquals(check.result, "allowed");
  if (check.result !== "allowed") {
    throw new Error("test setup requires repair");
  }
  assertEquals((await readmeStaticFeature.planEnable(drifted, check)).changes, [
    {
      kind: "set-file-mode",
      path: "README.md",
      mode: 0o640,
      expectedMode: 0o440,
    },
    {
      kind: "write-file",
      path: "README.md",
      content: "# example\n",
      expectedDigest: "drift-digest",
    },
  ]);
});

test("readme-static preserves unselected writable content and blocks ambiguity", async () => {
  const unselected = context(
    { kind: "file", content: "# edited\n", digest: "x", mode: 0o644 },
    { kind: "features", featureIds: [] },
  );
  const ambiguous = context(
    { kind: "symlink", target: "elsewhere" },
    { kind: "all-drifted" },
  );
  assertEquals(
    (await readmeStaticFeature.checkEnable(unselected)).result,
    "no-op",
  );
  assertEquals(
    (await readmeStaticFeature.checkEnable(ambiguous)).result,
    "blocked",
  );
});

test("readme-static detects and repairs badge placement without replacing custom prose", async () => {
  const content =
    "# Project\n\n[![Badge](badge.svg)](target)\n\nIntroduction.\n\n| Area | Details |\n| --- | --- |\n| Code | Tools |\n";
  const observation = {
    kind: "file" as const,
    content,
    digest: "before",
    mode: 0o644,
  };
  const ctx = context(observation);
  const detected = await readmeStaticFeature.detect(ctx);
  assertEquals(detected.state, "drifted");
  const blocked = await readmeStaticFeature.checkEnable({
    ...ctx,
    repair: undefined,
  });
  assertEquals(blocked.result, "blocked");
  const check = await readmeStaticFeature.checkEnable(ctx);
  if (check.result !== "allowed") throw new Error("Expected repair");
  const plan = await readmeStaticFeature.planEnable(ctx, check);
  const write = plan.changes[0];
  if (write.kind !== "write-file") throw new Error("Expected content repair");
  assertEquals(write.expectedDigest, "before");
  assertEquals(
    write.content.indexOf("Introduction.") < write.content.indexOf("[![Badge]"),
    true,
  );
  assertEquals(
    write.content.indexOf("[![Badge]") < write.content.indexOf("| Area"),
    true,
  );
  const fixed = context({ ...observation, content: write.content });
  assertEquals((await readmeStaticFeature.detect(fixed)).state, "enabled");
  assertEquals((await readmeStaticFeature.checkEnable(fixed)).result, "no-op");
});
