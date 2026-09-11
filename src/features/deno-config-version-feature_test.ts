import { assertEquals, assertRejects } from "@std/assert";
import type { ArtifactObservation } from "../api/artifact-inspection.ts";
import type { OperationContext } from "../api/repository-context.ts";
import { denoConfigVersionFeature } from "./deno-config-version-feature.ts";

function context(
  observations: Record<string, ArtifactObservation>,
): OperationContext {
  return {
    repositoryRoot: new URL("file:///work/repository/"),
    files: {
      observe: (path) =>
        Promise.resolve(observations[path] ?? { kind: "absent" }),
      exists: () => Promise.resolve(false),
      readText: () => Promise.resolve(undefined),
      readJson: () => Promise.resolve(undefined),
      digest: () => Promise.resolve(undefined),
      directoryStateDigest: () => Promise.resolve(undefined),
      mode: () => Promise.resolve(undefined),
    },
    git: {
      isRepository: () => Promise.resolve(false),
      head: () => Promise.resolve(undefined),
      status: () => Promise.resolve({ isClean: true, changedPaths: [] }),
      remotes: () => Promise.resolve([]),
      defaultBranch: () => Promise.resolve(undefined),
    },
    detections: new Map(),
    requestedChanges: [],
    resolvedChanges: [],
    repair: undefined,
    options: {},
  };
}

function file(content: string): ArtifactObservation {
  return { kind: "file", content, digest: "digest", mode: 0o644 };
}

Deno.test("Deno config version detects absent, exact, malformed, and duplicate configurations", async () => {
  const cases = [
    [{}, "disabled"],
    [{ "deno.json": file('{"version":"1.2.3"}\n') }, "enabled"],
    [{ "deno.jsonc": file('{"version":"not-semver"}\n') }, "ambiguous"],
    [{ "deno.json": file("{"), "deno.jsonc": file("{}") }, "ambiguous"],
  ] as const;
  for (const [observations, state] of cases) {
    assertEquals(
      (await denoConfigVersionFeature.detect(context(observations))).state,
      state,
    );
  }
});

Deno.test("Deno config version never creates or removes version data", async () => {
  const absent = context({});
  const valid = context({ "deno.json": file('{"version":"1.2.3"}\n') });
  const malformed = context({ "deno.json": file('{"version":3}\n') });
  assertEquals(
    (await denoConfigVersionFeature.checkEnable(absent)).result,
    "blocked",
  );
  assertEquals(
    (await denoConfigVersionFeature.checkEnable(valid)).result,
    "no-op",
  );
  assertEquals(
    (await denoConfigVersionFeature.checkDisable(valid)).result,
    "blocked",
  );
  assertEquals(
    (await denoConfigVersionFeature.checkDisable(absent)).result,
    "no-op",
  );
  assertEquals(
    (await denoConfigVersionFeature.checkEnable(malformed)).result,
    "blocked",
  );
  await assertRejects(() =>
    denoConfigVersionFeature.planEnable(absent, {
      result: "allowed",
      warnings: [],
      preconditions: [],
    })
  );
  await assertRejects(() =>
    denoConfigVersionFeature.planDisable(valid, {
      result: "allowed",
      warnings: [],
      preconditions: [],
    })
  );
});
