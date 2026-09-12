import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import {
  chmod,
  fixtureStat,
  makeTempDir,
  mkdir,
  readTextFile,
  remove,
  writeTextFile,
} from "../testing/files-test-fixtures.ts";
import { runCommand } from "../runtime/command.ts";
import { assert, assertEquals } from "@std/assert";
import type { OperationContext } from "../api/repository-context.ts";
import { applyLocalChangePlan } from "../operations/local-change-plan.ts";
import { LocalFileReader } from "../repository/local-file-reader.ts";
import { builtInFeatureRegistry } from "./built-in-feature-registry.ts";
import { denoCliArtifacts } from "./deno-cli-artifacts.ts";
import { denoCliFeature } from "./deno-cli-feature.ts";
import { resolveFeatureChanges } from "./resolve-feature-changes.ts";

test("deno-cli resolves deno-fmt and shares initial exports", async () => {
  assertEquals(denoCliArtifacts.map((artifact) => artifact.path), [
    "src/cli/cli.ts",
    "src/cli/command.ts",
    "src/cli/commands.ts",
    "test/cli_test.ts",
  ]);
  assertEquals(denoCliArtifacts.map((artifact) => artifact.mode), [
    0o755,
    0o644,
    0o644,
    0o644,
  ]);
  const detections = Object.fromEntries(
    builtInFeatureRegistry.features.map((
      feature,
    ) => [feature.metadata.id, { state: "disabled" as const, evidence: [] }]),
  );
  const resolved = resolveFeatureChanges(builtInFeatureRegistry, detections, {
    changes: [{ featureId: "deno-cli", enabled: true }, {
      featureId: "deno-lib",
      enabled: true,
    }],
    presets: [],
    applyDefaults: false,
    defaults: [],
  }).changes;
  assertEquals(resolved.map((change) => change.featureId), [
    "deno-fmt",
    "deno-cli",
    "deno-lib",
  ]);
  await withRepository(async (root) => {
    for (const change of resolved) {
      const feature = builtInFeatureRegistry.features.find((item) =>
        item.metadata.id === change.featureId
      )!;
      const check = await feature.checkEnable(context(root, resolved));
      if (check.result !== "allowed") {
        throw new Error("test setup requires enable");
      }
      await applyLocalChangePlan(
        root,
        await feature.planEnable(context(root, resolved), check),
      );
    }
    const config = await readTextFile(new URL("deno.jsonc", root));
    assert(config.includes('"./cli": "./src/cli/cli.ts"'));
    assert(config.includes('".": "./src/lib/mod.ts"'));
    for (const artifact of denoCliArtifacts) {
      assert((await fixtureStat(new URL(artifact.path, root))).isFile);
    }
    const result = await runCommand("deno", {
      args: ["test", "test/cli_test.ts"],
      cwd: root.pathname,
    });
    assert(
      result.success,
      `Generated CLI smoke test failed:\n${
        new TextDecoder().decode(result.stderr)
      }`,
    );
  });
});

test("deno-cli adopts, repairs content and mode, then preserves seed on disable", async () => {
  await withRepository(async (root) => {
    await apply(root);
    assertEquals((await denoCliFeature.detect(context(root))).state, "enabled");
    await writeTextFile(
      new URL("src/cli/commands.ts", root),
      "edited\n",
    );
    await chmod(new URL("src/cli/cli.ts", root), 0o644);
    await chmod(new URL("src/cli/commands.ts", root), 0o755);
    assertEquals((await denoCliFeature.detect(context(root))).state, "enabled");
    assertEquals(
      (await denoCliFeature.checkEnable(context(root))).result,
      "no-op",
    );
    await apply(root, { kind: "features", featureIds: ["deno-cli"] });
    for (const artifact of denoCliArtifacts) {
      assertEquals(
        await readTextFile(new URL(artifact.path, root)),
        artifact.content,
      );
      assertEquals(
        (await fixtureStat(new URL(artifact.path, root))).mode! & 0o777,
        artifact.mode,
      );
    }
    const disable = await denoCliFeature.checkDisable(context(root));
    if (disable.result !== "allowed") {
      throw new Error("test setup requires disable");
    }
    await applyLocalChangePlan(
      root,
      await denoCliFeature.planDisable(context(root), disable),
    );
    assertEquals(
      (await denoCliFeature.detect(context(root))).state,
      "disabled",
    );
    for (const artifact of denoCliArtifacts) {
      assert((await fixtureStat(new URL(artifact.path, root))).isFile);
    }
  });
});

test("deno-cli preserves JSONC and blocks path and export conflicts", async () => {
  await withRepository(async (root) => {
    await writeTextFile(
      new URL("deno.jsonc", root),
      '{\n  // keep\n  "name": "example"\n}\n',
    );
    await apply(root);
    assert(
      (await readTextFile(new URL("deno.jsonc", root))).includes(
        "// keep",
      ),
    );
  });
  await withRepository(async (root) => {
    await mkdir(new URL("src/", root));
    await writeTextFile(new URL("src/cli", root), "conflict\n");
    assertEquals(
      (await denoCliFeature.checkEnable(context(root))).result,
      "blocked",
    );
  });
  await withRepository(async (root) => {
    await writeTextFile(
      new URL("deno.jsonc", root),
      '{ "exports": { "./cli": "./other.ts" } }\n',
    );
    assertEquals(
      (await denoCliFeature.checkDisable(context(root))).result,
      "blocked",
    );
  });
});

async function apply(
  root: URL,
  repair: OperationContext["repair"] = undefined,
) {
  const current = context(root, [], repair);
  const check = await denoCliFeature.checkEnable(current);
  if (check.result !== "allowed") throw new Error("test setup requires enable");
  await applyLocalChangePlan(
    root,
    await denoCliFeature.planEnable(current, check),
  );
}

function context(
  root: URL,
  resolvedChanges: OperationContext["resolvedChanges"] = [],
  repair: OperationContext["repair"] = undefined,
): OperationContext {
  const files = new LocalFileReader(root);
  return {
    repositoryRoot: root,
    files,
    git: {
      isRepository: () => Promise.reject(),
      head: () => Promise.reject(),
      status: () => Promise.reject(),
      remotes: () => Promise.reject(),
      defaultBranch: () => Promise.reject(),
    },
    detections: new Map(),
    requestedChanges: [],
    resolvedChanges,
    repair,
    options: {},
  };
}

async function withRepository(
  action: (root: URL) => Promise<void>,
): Promise<void> {
  const path = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-deno-cli-",
  });
  try {
    await action(new URL(`file://${path}/`));
  } finally {
    await remove(path, { recursive: true });
  }
}
