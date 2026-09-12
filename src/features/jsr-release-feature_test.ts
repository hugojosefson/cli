import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import {
  makeTempDir,
  mkdir,
  readTextFile,
  remove,
  writeTextFile,
} from "../testing/files-test-fixtures.ts";
import { assertEquals, assertRejects } from "@std/assert";
import type { ArtifactObservation } from "../api/artifact-inspection.ts";
import type { OperationContext } from "../api/repository-context.ts";
import { applyLocalChangePlan } from "../operations/local-change-plan.ts";
import { LocalFileReader } from "../repository/local-file-reader.ts";
import {
  jsrReleaseArtifact,
  jsrReleaseMarker,
} from "./jsr-release-artifacts.ts";
import { jsrReleaseFeature } from "./jsr-release-feature.ts";

function context(
  observations: Record<string, ArtifactObservation>,
  repair?: OperationContext["repair"],
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
    github: undefined,
    detections: new Map(),
    requestedChanges: [],
    resolvedChanges: [],
    repair,
    options: {},
  };
}
function exact(): Extract<ArtifactObservation, { kind: "file" }> {
  return {
    kind: "file",
    content: jsrReleaseArtifact.content,
    digest: "release-digest",
    mode: 0o644,
  };
}

test("jsr-release detects absent, exact, drifted, custom, and mode-insensitive workflows", async () => {
  assertEquals((await jsrReleaseFeature.detect(context({}))).state, "disabled");
  assertEquals(
    (await jsrReleaseFeature.detect(
      context({ [jsrReleaseArtifact.path]: exact() }),
    )).state,
    "enabled",
  );
  assertEquals(
    (await jsrReleaseFeature.detect(
      context({
        [jsrReleaseArtifact.path]: {
          ...exact(),
          mode: 0o440,
          access: {
            readable: true,
            writable: false,
            executable: false,
            shift: 6,
          },
        },
      }),
    )).state,
    "enabled",
  );
  assertEquals(
    (await jsrReleaseFeature.detect(
      context({
        [jsrReleaseArtifact.path]: {
          ...exact(),
          content: `${jsrReleaseMarker}changed\n`,
        },
      }),
    )).state,
    "drifted",
  );
  assertEquals(
    (await jsrReleaseFeature.detect(
      context({
        [jsrReleaseArtifact.path]: { ...exact(), content: "name: Custom\n" },
      }),
    )).state,
    "ambiguous",
  );
});

test("jsr-release has only the required direct dependencies", () => {
  assertEquals(
    jsrReleaseFeature.dependencies.requires.map((item) => item.featureId),
    ["jsr-package", "github-protected-tags"],
  );
});

test("jsr-release gates repair, protects custom content, and checks parents", async () => {
  const drifted = {
    [jsrReleaseArtifact.path]: {
      ...exact(),
      content: `${jsrReleaseMarker}changed\n`,
    },
  };
  assertEquals(
    (await jsrReleaseFeature.checkEnable(context(drifted))).result,
    "blocked",
  );
  assertEquals(
    (await jsrReleaseFeature.checkEnable(
      context(drifted, { kind: "features", featureIds: ["jsr-release"] }),
    )).result,
    "allowed",
  );
  assertEquals(
    (await jsrReleaseFeature.checkEnable(
      context({ [jsrReleaseArtifact.path]: { ...exact(), content: "custom" } }),
    )).result,
    "blocked",
  );
  assertEquals(
    (await jsrReleaseFeature.checkDisable(context(drifted))).result,
    "blocked",
  );
  assertEquals(
    (await jsrReleaseFeature.checkEnable(
      context({
        ".github": { kind: "file", content: "x", digest: "x", mode: 0o644 },
      }),
    )).result,
    "blocked",
  );
  assertEquals(
    (await jsrReleaseFeature.checkEnable(
      context({ ".github/workflows": { kind: "symlink", target: "x" } }),
    )).result,
    "blocked",
  );
});

test("jsr-release lifecycle preserves unrelated workflows", async () => {
  const path = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-release-",
  });
  const root = new URL(`file://${path}/`);
  try {
    await mkdir(new URL(".github/workflows/", root), { recursive: true });
    const unrelated = new URL(".github/workflows/custom.yaml", root);
    await writeTextFile(unrelated, "name: Custom\n");
    const current = contextFor(root);
    const enable = await jsrReleaseFeature.checkEnable(current);
    if (enable.result !== "allowed") {
      throw new Error("test setup requires enable");
    }
    await applyLocalChangePlan(
      root,
      await jsrReleaseFeature.planEnable(current, enable),
    );
    const disableCurrent = contextFor(root);
    const disable = await jsrReleaseFeature.checkDisable(disableCurrent);
    if (disable.result !== "allowed") {
      throw new Error("test setup requires disable");
    }
    await applyLocalChangePlan(
      root,
      await jsrReleaseFeature.planDisable(disableCurrent, disable),
    );
    assertEquals(await readTextFile(unrelated), "name: Custom\n");
  } finally {
    await remove(path, { recursive: true });
  }
});

test("jsr-release plans reject workflow changes after checks", async () => {
  const observations: Record<string, ArtifactObservation> = {};
  const current = context(observations);
  const enable = await jsrReleaseFeature.checkEnable(current);
  if (enable.result !== "allowed") throw new Error("expected enable");
  observations[jsrReleaseArtifact.path] = {
    ...exact(),
    content: "name: Custom\n",
  };
  await assertRejects(() => jsrReleaseFeature.planEnable(current, enable));

  observations[jsrReleaseArtifact.path] = exact();
  const disable = await jsrReleaseFeature.checkDisable(current);
  if (disable.result !== "allowed") throw new Error("expected disable");
  observations[jsrReleaseArtifact.path] = {
    ...exact(),
    content: "name: Custom\n",
  };
  await assertRejects(() => jsrReleaseFeature.planDisable(current, disable));
});

function contextFor(root: URL): OperationContext {
  return {
    ...context({}),
    repositoryRoot: root,
    files: new LocalFileReader(root),
  };
}
