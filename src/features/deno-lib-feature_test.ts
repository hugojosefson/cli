import { assert, assertEquals } from "@std/assert";
import type { OperationContext } from "../api/repository-context.ts";
import { applyLocalChangePlan } from "../operations/local-change-plan.ts";
import { LocalFileReader } from "../repository/local-file-reader.ts";
import { builtInFeatureRegistry } from "./built-in-feature-registry.ts";
import { denoLibFeature } from "./deno-lib-feature.ts";
import { resolveFeatureChanges } from "./resolve-feature-changes.ts";

Deno.test("deno-lib resolution enables deno-fmt first", () => {
  const detections = Object.fromEntries(
    builtInFeatureRegistry.features.map((feature) => [
      feature.metadata.id,
      { state: "disabled" as const, evidence: [] },
    ]),
  );
  assertEquals(
    resolveFeatureChanges(builtInFeatureRegistry, detections, {
      changes: [{ featureId: "deno-lib", enabled: true }],
      presets: [],
      applyDefaults: false,
      defaults: [],
    }).changes.map((change) => change.featureId),
    ["deno-fmt", "deno-lib"],
  );
});

Deno.test("deno-lib creates starter files, repairs drift, and preserves them on disable", async () => {
  await withRepository(async (root) => {
    await apply(root);
    assertEquals((await denoLibFeature.detect(context(root))).state, "enabled");
    await Deno.writeTextFile(new URL("src/lib/mod.ts", root), "edited\n");
    await Deno.chmod(new URL("src/lib/mod.ts", root), 0o755);
    assertEquals((await denoLibFeature.detect(context(root))).state, "drifted");
    assertEquals(
      (await denoLibFeature.checkEnable(context(root))).result,
      "blocked",
    );
    const repair = await repairPlan(root);
    assert(repair.changes.some((change) => change.kind === "write-file"));
    assert(
      repair.changes.some((change) =>
        change.kind === "set-file-mode" && change.expectedMode === 0o755
      ),
    );
    await applyLocalChangePlan(root, repair);
    assertEquals(
      await Deno.readTextFile(new URL("src/lib/mod.ts", root)),
      "export function placeholder(): void {}\n",
    );
    await Deno.chmod(new URL("src/lib/mod.ts", root), 0o755);
    const modeRepair = await repairPlan(root);
    assertEquals(modeRepair.changes.map((change) => change.kind), [
      "set-file-mode",
    ]);
    await applyLocalChangePlan(root, modeRepair);
    assertEquals(
      (await Deno.stat(new URL("src/lib/mod.ts", root))).mode! & 0o777,
      0o644,
    );
    const disable = await denoLibFeature.checkDisable(context(root));
    if (disable.result !== "allowed") {
      throw new Error("test setup requires disable");
    }
    await applyLocalChangePlan(
      root,
      await denoLibFeature.planDisable(context(root), disable),
    );
    assertEquals(
      (await denoLibFeature.detect(context(root))).state,
      "disabled",
    );
    assert((await Deno.stat(new URL("src/lib/mod.ts", root))).isFile);
    assert((await Deno.stat(new URL("test/lib_test.ts", root))).isFile);
  });
});

Deno.test("deno-lib preserves unrelated existing JSONC content and blocks ambiguous paths", async () => {
  await withRepository(async (root) => {
    await Deno.writeTextFile(
      new URL("deno.jsonc", root),
      '{\n  // keep\n  "name": "example"\n}\n',
    );
    await apply(root);
    const config = await Deno.readTextFile(new URL("deno.jsonc", root));
    assert(config.includes("// keep"));
    assert(config.includes('"name": "example"'));
  });
  await withRepository(async (root) => {
    await Deno.writeTextFile(new URL("src", root), "not a directory\n");
    assertEquals(
      (await denoLibFeature.detect(context(root))).state,
      "disabled",
    );
    assertEquals(
      (await denoLibFeature.checkEnable(context(root))).result,
      "blocked",
    );
  });
});

Deno.test("deno-lib blocks disabling a differing root export", async () => {
  await withRepository(async (root) => {
    await Deno.writeTextFile(
      new URL("deno.jsonc", root),
      '{ "exports": { ".": "./other.ts" } }\n',
    );
    assertEquals(
      (await denoLibFeature.checkDisable(context(root))).result,
      "blocked",
    );
  });
});

async function apply(
  root: URL,
  repair: OperationContext["repair"] = undefined,
) {
  const current = context(root, repair);
  const check = await denoLibFeature.checkEnable(current);
  if (check.result !== "allowed") throw new Error("test setup requires enable");
  await applyLocalChangePlan(
    root,
    await denoLibFeature.planEnable(current, check),
  );
}

async function repairPlan(root: URL) {
  const current = context(root, { kind: "features", featureIds: ["deno-lib"] });
  const check = await denoLibFeature.checkEnable(current);
  if (check.result !== "allowed") throw new Error("test setup requires repair");
  return await denoLibFeature.planEnable(current, check);
}

function context(
  root: URL,
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
    resolvedChanges: [],
    repair,
    options: {},
  };
}

async function withRepository(
  action: (root: URL) => Promise<void>,
): Promise<void> {
  const path = await Deno.makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-deno-lib-",
  });
  try {
    await action(new URL(`file://${path}/`));
  } finally {
    await Deno.remove(path, { recursive: true });
  }
}
