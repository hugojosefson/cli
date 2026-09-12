import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import { assertEquals, assertRejects } from "@std/assert";
import type {
  DetectionContext,
  OperationContext,
} from "../api/repository-context.ts";
import { gitFeature } from "./git-feature.ts";

function detectionContext(isRepository: boolean): DetectionContext {
  return {
    repositoryRoot: new URL("file:///work/target/"),
    files: {
      observe: () => Promise.resolve({ kind: "absent" }),
      exists: () => Promise.resolve(false),
      readText: () => Promise.resolve(undefined),
      readJson: () => Promise.resolve(undefined),
      digest: () => Promise.resolve(undefined),
      directoryStateDigest: () => Promise.resolve(undefined),
      mode: () => Promise.resolve(undefined),
    },
    git: {
      isRepository: () => Promise.resolve(isRepository),
      head: () => Promise.resolve(undefined),
      status: () => Promise.resolve(undefined),
      remotes: () => Promise.resolve([]),
      defaultBranch: () => Promise.resolve(undefined),
    },
  };
}

function operationContext(isRepository: boolean): OperationContext {
  return {
    ...detectionContext(isRepository),
    detections: new Map(),
    requestedChanges: [],
    resolvedChanges: [],
    repair: undefined,
    options: {},
  };
}

test("Git detection reports repository state with deterministic evidence", async () => {
  assertEquals(await gitFeature.detect(detectionContext(true)), {
    state: "enabled",
    evidence: [{
      code: "git-repository-detected",
      kind: "git-repository",
      subject: { kind: "repository", identifier: "file:///work/target/" },
      observation: "The target is a Git repository.",
    }],
  });
  assertEquals(await gitFeature.detect(detectionContext(false)), {
    state: "disabled",
    evidence: [{
      code: "git-repository-not-detected",
      kind: "git-repository",
      subject: { kind: "repository", identifier: "file:///work/target/" },
      observation: "The target is not a Git repository.",
    }],
  });
});

test("Git enable is a no-op when enabled and otherwise plans git-init", async () => {
  assertEquals(await gitFeature.checkEnable(operationContext(true)), {
    result: "no-op",
    reason: "The target is already a Git repository.",
    warnings: [],
  });
  const allowed = await gitFeature.checkEnable(operationContext(false));
  assertEquals(allowed, {
    result: "allowed",
    warnings: [],
    preconditions: [{ kind: "git-repository", exists: false }],
  });
  if (allowed.result !== "allowed") {
    throw new Error("test setup requires an allowed operation");
  }
  assertEquals(await gitFeature.planEnable(operationContext(false), allowed), {
    featureId: "git",
    action: "enable",
    summary: "Initialize the target as a Git repository.",
    warnings: [],
    preconditions: [{ kind: "git-repository", exists: false }],
    changes: [{ kind: "git-init" }],
    validations: [{
      kind: "feature-redetection",
      featureId: "git",
      expected: "enabled",
    }],
  });
});

test("Git disable blocks removal and is a no-op outside a repository", async () => {
  const context = operationContext(true);
  assertEquals(await gitFeature.checkDisable(context), {
    result: "blocked",
    blockers: [{
      code: "git-disable-is-destructive",
      message:
        "Git repositories cannot be disabled because removing .git is destructive and non-reversible.",
      subjects: [{ kind: "repository", identifier: "file:///work/target/" }],
      resolution: "Keep Git enabled; do not remove .git.",
    }],
    warnings: [],
  });
  await assertRejects(
    () =>
      gitFeature.planDisable(context, {
        result: "allowed",
        warnings: [],
        preconditions: [],
      }),
    Error,
    "Git cannot be disabled.",
  );
  assertEquals(await gitFeature.checkDisable(operationContext(false)), {
    result: "no-op",
    reason: "The target is not a Git repository.",
    warnings: [],
  });
});
