import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import { runRawCommand as runCommand } from "../runtime/command.ts";
import {
  chmod,
  fixtureStat,
  makeTempDir,
  mkdir,
  readTextFile,
  remove,
  writeTextFile,
} from "../testing/files-test-fixtures.ts";
import { assert, assertEquals, assertRejects } from "@std/assert";
import type { OperationContext } from "../api/repository-context.ts";
import { applyLocalChangePlan } from "../operations/local-change-plan.ts";
import { LocalFileReader } from "../repository/local-file-reader.ts";
import { legacyServerAdapter } from "./deno-server-legacy.ts";
import { denoServerTasks } from "./deno-server-tasks.ts";
import { parseFeatures } from "../cli/parse-features.ts";
import { runFeatureOperation } from "../cli/run-features.ts";
import { builtInFeatureRegistry } from "./built-in-feature-registry.ts";
import { denoCliFeature } from "./deno-cli-feature.ts";
import { denoServerArtifacts } from "./deno-server-artifacts.ts";
import { denoServerFeature } from "./deno-server-feature.ts";

test("deno-server creates dependency-free seeds and smoke test", async () => {
  assertEquals(denoServerArtifacts.map((item) => item.path), [
    "src/server/server.ts",
    "test/server_test.ts",
  ]);
  await withRepository(async (root) => {
    await enable(root, denoServerFeature);
    assertEquals(
      (await denoServerFeature.detect(context(root))).state,
      "enabled",
    );
    const result = await runCommand("deno", {
      args: ["test", "test/server_test.ts"],
      cwd: root.pathname,
    });
    assert(result.success, new TextDecoder().decode(result.stderr));
    const disable = await denoServerFeature.checkDisable(context(root));
    if (disable.result !== "allowed") {
      throw new Error("test setup requires disable");
    }
    await applyLocalChangePlan(
      root,
      await denoServerFeature.planDisable(context(root), disable),
    );
    assertEquals(
      (await denoServerFeature.detect(context(root))).state,
      "disabled",
    );
    for (const artifact of denoServerArtifacts) {
      assert((await fixtureStat(new URL(artifact.path, root))).isFile);
    }
    const config = JSON.parse(
      await readTextFile(new URL("deno.jsonc", root)),
    );
    assertEquals(config.tasks.serve, undefined);
    assertEquals(config.tasks.dev, undefined);
    assertEquals(await context(root).files.exists("src/cli"), false);
  });
});

test("deno-server composes the exact CLI registry", async () => {
  await withRepository(async (root) => {
    await enable(root, denoCliFeature);
    const changes = [{
      featureId: "deno-server",
      enabled: true,
      reason: { kind: "explicit-request" as const },
    }];
    await enable(root, denoServerFeature, changes);
    assert(
      (await readTextFile(new URL("src/cli/commands.ts", root))).includes(
        "serveCommand",
      ),
    );
    assertEquals((await denoCliFeature.detect(context(root))).state, "enabled");
    assert(
      (await readTextFile(new URL("src/cli/cli.ts", root)))
        .includes('DENO_RUN_ARGS="--allow-net=0.0.0.0:8000"'),
    );
    const disable = await denoServerFeature.checkDisable(
      context(root, changes),
    );
    if (disable.result !== "allowed") {
      throw new Error("test setup requires disable");
    }
    await applyLocalChangePlan(
      root,
      await denoServerFeature.planDisable(context(root, changes), disable),
    );
    assertEquals((await denoCliFeature.detect(context(root))).state, "enabled");
    assert(
      (await readTextFile(new URL("src/cli/cli.ts", root)))
        .includes('DENO_RUN_ARGS=""'),
    );
  });
});

test("deno-server repairs selected content and mode drift", async () => {
  await withRepository(async (root) => {
    await enable(root, denoServerFeature);
    await writeTextFile(new URL("src/server/server.ts", root), "edited\n");
    await chmod(new URL("test/server_test.ts", root), 0o755);
    assertEquals(
      (await denoServerFeature.detect(context(root))).state,
      "drifted",
    );
    assertEquals(
      (await denoServerFeature.checkEnable(context(root))).result,
      "blocked",
    );
    const repair = { kind: "features" as const, featureIds: ["deno-server"] };
    const current = context(root, [], repair);
    const check = await denoServerFeature.checkEnable(current);
    if (check.result !== "allowed") {
      throw new Error("test setup requires repair");
    }
    await applyLocalChangePlan(
      root,
      await denoServerFeature.planEnable(current, check),
    );
    for (const artifact of denoServerArtifacts) {
      assertEquals(
        await readTextFile(new URL(artifact.path, root)),
        artifact.content,
      );
      assertEquals(
        (await fixtureStat(new URL(artifact.path, root))).mode! & 0o777,
        0o644,
      );
    }
  });
});

test("deno-server blocks export, path, and CLI registry conflicts", async () => {
  await withRepository(async (root) => {
    await writeTextFile(
      new URL("deno.jsonc", root),
      '{ "exports": { "./server": "./other.ts" } }\n',
    );
    assertEquals(
      (await denoServerFeature.checkEnable(context(root))).result,
      "blocked",
    );
    assertEquals(
      (await denoServerFeature.checkDisable(context(root))).result,
      "blocked",
    );
  });
  await withRepository(async (root) => {
    await writeTextFile(new URL("deno.json", root), "{}\n");
    await writeTextFile(new URL("deno.jsonc", root), "{}\n");
    assertEquals(
      (await denoServerFeature.checkEnable(context(root))).result,
      "blocked",
    );
  });
  await withRepository(async (root) => {
    await mkdir(new URL("src", root));
    await writeTextFile(new URL("src/server", root), "conflict\n");
    assertEquals(
      (await denoServerFeature.checkEnable(context(root))).result,
      "blocked",
    );
  });
  await withRepository(async (root) => {
    await enable(root, denoCliFeature);
    await enable(root, denoServerFeature, [{
      featureId: "deno-server",
      enabled: true,
      reason: { kind: "explicit-request" },
    }]);
    await writeTextFile(new URL("src/cli/commands.ts", root), "edited\n");
    assertEquals(
      (await denoServerFeature.checkEnable(context(root))).result,
      "blocked",
    );
    assertEquals(
      (await denoServerFeature.checkDisable(context(root))).result,
      "blocked",
    );
  });
});

test("server tasks compose with existing configuration and preserve custom tasks", async () => {
  for (const config of [{}, { tasks: { custom: "echo keep" } }]) {
    await withRepository(async (root) => {
      await writeTextFile(
        new URL("deno.json", root),
        JSON.stringify(config),
      );
      const output = await runFeatures(
        root,
        parseFeatures(
          ["repo", "features", "--deno-server"],
          builtInFeatureRegistry,
        ),
      );
      assert(output.replace(/ +/g, " ").includes("deno-server enabled"));
      const value = JSON.parse(
        await readTextFile(new URL("deno.json", root)),
      );
      assertEquals(value.tasks.serve, denoServerTasks.serve);
      assertEquals(value.tasks.dev, denoServerTasks.dev);
      if ("tasks" in config) assertEquals(value.tasks.custom, "echo keep");
      assertEquals(
        (await denoServerFeature.checkEnable(context(root))).result,
        "no-op",
      );
    });
  }
});

test("server task drift needs repair and custom tasks cannot be removed", async () => {
  await withRepository(async (root) => {
    await enable(root, denoServerFeature);
    const path = new URL("deno.jsonc", root);
    const config = JSON.parse(await readTextFile(path));
    delete config.tasks.dev;
    config.tasks.serve = { command: "custom-server" };
    await writeTextFile(path, JSON.stringify(config));
    assertEquals(
      (await denoServerFeature.detect(context(root))).state,
      "drifted",
    );
    assertEquals(
      (await denoServerFeature.checkEnable(context(root))).result,
      "blocked",
    );
    assertEquals(
      (await denoServerFeature.checkDisable(context(root))).result,
      "blocked",
    );
    const current = context(root, [], {
      kind: "features",
      featureIds: ["deno-server"],
    });
    const check = await denoServerFeature.checkEnable(current);
    if (check.result !== "allowed") throw new Error("expected repair");
    const plan = await denoServerFeature.planEnable(current, check);
    await applyLocalChangePlan(root, plan);
    assertEquals(
      (await denoServerFeature.detect(context(root))).state,
      "enabled",
    );
    const disable = await denoServerFeature.checkDisable(context(root));
    if (disable.result !== "allowed") throw new Error("expected disable");
    const removal = await denoServerFeature.planDisable(context(root), disable);
    const changed = JSON.parse(await readTextFile(path));
    changed.tasks.dev = { command: "keep-custom-dev" };
    await writeTextFile(path, JSON.stringify(changed));
    await assertRejects(() => applyLocalChangePlan(root, removal));
    assertEquals(
      JSON.parse(await readTextFile(path)).exports["./server"],
      "./src/server/server.ts",
    );
  });
});

test("malformed server tasks and custom CLI adapters block setup", async () => {
  await withRepository(async (root) => {
    await enable(root, denoServerFeature);
    const path = new URL("deno.jsonc", root);
    const config = JSON.parse(await readTextFile(path));
    config.tasks = [];
    await writeTextFile(path, JSON.stringify(config));
    assertEquals(
      (await denoServerFeature.detect(context(root))).state,
      "ambiguous",
    );
    assertEquals(
      (await denoServerFeature.checkEnable(context(root))).result,
      "blocked",
    );
    assertEquals(
      (await denoServerFeature.checkDisable(context(root))).result,
      "blocked",
    );
  });
  await withRepository(async (root) => {
    await enable(root, denoCliFeature);
    await writeTextFile(
      new URL("src/cli/serve-command.ts", root),
      "custom adapter",
    );
    assertEquals(
      (await denoServerFeature.checkEnable(context(root))).result,
      "blocked",
    );
    assertEquals(await context(root).files.exists("src/server"), false);
  });
});

test("server repair migrates the exact old adapter and CLI registry", async () => {
  await withRepository(async (root) => {
    await enable(root, denoCliFeature);
    await enable(root, denoServerFeature);
    const registryPath = new URL("src/cli/commands.ts", root);
    const registry = await readTextFile(registryPath);
    await writeTextFile(
      registryPath,
      registry.replace('"./serve-command.ts"', '"../server/serve-command.ts"'),
    );
    await remove(new URL("src/cli/serve-command.ts", root));
    await writeTextFile(
      new URL(legacyServerAdapter.path, root),
      legacyServerAdapter.content,
    );
    await chmod(new URL(legacyServerAdapter.path, root), 0o644);
    const current = context(root, [], {
      kind: "features",
      featureIds: ["deno-server"],
    });
    const check = await denoServerFeature.checkEnable(current);
    if (check.result !== "allowed") throw new Error("expected migration");
    await applyLocalChangePlan(
      root,
      await denoServerFeature.planEnable(current, check),
    );
    assertEquals(await current.files.exists(legacyServerAdapter.path), false);
    assertEquals(await readTextFile(registryPath), registry);
    assertEquals(await current.files.exists("src/cli/serve-command.ts"), true);
  });
});

test("server setup preserves custom CLI launchers and repairs its old launcher", async () => {
  await withRepository(async (root) => {
    await enable(root, denoCliFeature);
    const path = new URL("src/cli/cli.ts", root);
    const base = await readTextFile(path);
    await writeTextFile(path, base + "// custom launcher\n");
    assertEquals(
      (await denoServerFeature.checkEnable(context(root))).result,
      "blocked",
    );
    await writeTextFile(path, base);
    await enable(root, denoServerFeature);
    const integrated = await readTextFile(path);
    await writeTextFile(path, base);
    assertEquals(
      (await denoServerFeature.detect(context(root))).state,
      "drifted",
    );
    const output = await runFeatures(
      root,
      parseFeatures(
        ["repo", "features", "--repair", "--deno-server"],
        builtInFeatureRegistry,
      ),
    );
    assert(output.replace(/ +/g, " ").includes("deno-server enabled"));
    assertEquals(await readTextFile(path), integrated);
    await writeTextFile(path, integrated + "// custom launcher\n");
    assertEquals(
      (await denoServerFeature.checkDisable(context(root))).result,
      "blocked",
    );
    assertEquals(
      await readTextFile(path),
      integrated + "// custom launcher\n",
    );
  });
});

async function enable(
  root: URL,
  feature: typeof denoServerFeature,
  changes: OperationContext["resolvedChanges"] = [],
) {
  const current = context(root, changes);
  const check = await feature.checkEnable(current);
  if (check.result !== "allowed") throw new Error("test setup requires enable");
  await applyLocalChangePlan(root, await feature.planEnable(current, check));
}

function context(
  root: URL,
  resolvedChanges: OperationContext["resolvedChanges"] = [],
  repair: OperationContext["repair"] = undefined,
): OperationContext {
  return {
    repositoryRoot: root,
    files: new LocalFileReader(root),
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
    prefix: "hj-deno-server-",
  });
  try {
    await action(new URL(`file://${path}/`));
  } finally {
    await remove(path, { recursive: true });
  }
}

// These fixtures inspect generated features and execute their tasks separately.
function runFeatures(
  root: URL,
  args: Parameters<typeof runFeatureOperation>[1],
) {
  return runFeatureOperation(root, args, builtInFeatureRegistry, undefined, {
    runFinalTask: () => Promise.resolve(undefined),
  });
}
