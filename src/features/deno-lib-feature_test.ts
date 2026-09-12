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
import { runRawCommand as runCommand } from "../runtime/command.ts";
import { matchesFileAccess } from "../repository/file-access.ts";
import { assert, assertEquals } from "@std/assert";
import type { OperationContext } from "../api/repository-context.ts";
import { applyLocalChangePlan } from "../operations/local-change-plan.ts";
import { LocalFileReader } from "../repository/local-file-reader.ts";
import { builtInFeatureRegistry } from "./built-in-feature-registry.ts";
import { denoLibFeature } from "./deno-lib-feature.ts";
import { denoLibArtifacts, denoLibAssertImport } from "./deno-lib-artifacts.ts";
import { parse } from "jsonc-parser";
import { resolveFeatureChanges } from "./resolve-feature-changes.ts";

test("deno-lib resolution enables deno-fmt first", () => {
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

test("deno-lib creates starter files, repairs drift, and preserves them on disable", async () => {
  await withRepository(async (root) => {
    await apply(root);
    assertEquals((await denoLibFeature.detect(context(root))).state, "enabled");
    await writeTextFile(new URL("src/lib/mod.ts", root), "edited\n");
    await chmod(new URL("src/lib/mod.ts", root), 0o755);
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
      await readTextFile(new URL("src/lib/mod.ts", root)),
      "export function placeholder(): void {}\n",
    );
    await chmod(new URL("src/lib/mod.ts", root), 0o755);
    const modeRepair = await repairPlan(root);
    assertEquals(modeRepair.changes.map((change) => change.kind), [
      "set-file-mode",
    ]);
    await applyLocalChangePlan(root, modeRepair);
    const observed = await new LocalFileReader(root).observe("src/lib/mod.ts");
    assert(observed.kind === "file");
    assert(matchesFileAccess(observed, 0o644));
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
    assert((await fixtureStat(new URL("src/lib/mod.ts", root))).isFile);
    assert((await fixtureStat(new URL("test/lib_test.ts", root))).isFile);
  });
});

test("deno-lib preserves unrelated existing JSONC content and blocks ambiguous paths", async () => {
  await withRepository(async (root) => {
    await writeTextFile(
      new URL("deno.jsonc", root),
      '{\n  // keep\n  "name": "example"\n}\n',
    );
    await apply(root);
    const config = await readTextFile(new URL("deno.jsonc", root));
    assert(config.includes("// keep"));
    assert(config.includes('"name": "example"'));
  });
  await withRepository(async (root) => {
    await writeTextFile(new URL("src", root), "not a directory\n");
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

test("deno-lib blocks disabling a differing root export", async () => {
  await withRepository(async (root) => {
    await writeTextFile(
      new URL("deno.jsonc", root),
      '{ "exports": { ".": "./other.ts" } }\n',
    );
    assertEquals(
      (await denoLibFeature.checkDisable(context(root))).result,
      "blocked",
    );
  });
});

test("deno-lib creates a runnable assertion starter and its dependency", async () => {
  await withRepository(async (root) => {
    await apply(root);
    assertEquals(
      await readTextFile(new URL("test/lib_test.ts", root)),
      'import { assertEquals } from "@std/assert";\nimport { placeholder } from "../src/lib/mod.ts";\n\nDeno.test("placeholder", async (t) => {\n  await t.step("should not throw", placeholder);\n\n  await t.step("should return undefined", () => {\n    assertEquals(placeholder(), undefined);\n  });\n});\n',
    );
    assertEquals(
      parse(await readTextFile(new URL("deno.jsonc", root)))
        .imports["@std/assert"],
      denoLibAssertImport,
    );
    const result = await runCommand("deno", {
      args: ["test", "test/lib_test.ts"],
      cwd: root,
    });
    assert(result.success, new TextDecoder().decode(result.stderr));
    const output = new TextDecoder().decode(result.stdout);
    assert(output.includes("should not throw"));
    assert(output.includes("should return undefined"));
  });
});

test("deno-lib preserves existing assertion mappings and unrelated JSONC imports", async () => {
  await withRepository(async (root) => {
    await writeTextFile(
      new URL("deno.jsonc", root),
      '{\n // custom imports\n "imports": {"@std/assert":"jsr:@std/assert@1.0.19","other":"./other.ts"}\n}\n',
    );
    await apply(root);
    const text = await readTextFile(new URL("deno.jsonc", root));
    assert(text.includes("// custom imports"));
    assertEquals(parse(text).imports, {
      "@std/assert": "jsr:@std/assert@1.0.19",
      other: "./other.ts",
    });
  });
  await withRepository(async (root) => {
    await writeTextFile(
      new URL("deno.jsonc", root),
      '{"imports":{"other":"./other.ts"}}',
    );
    await apply(root);
    assertEquals(
      parse(await readTextFile(new URL("deno.jsonc", root))).imports,
      { other: "./other.ts", "@std/assert": denoLibAssertImport },
    );
  });
});

test("deno-lib preserves customized tests through repair, disable, and re-enable", async () => {
  await withRepository(async (root) => {
    await apply(root);
    const custom = 'Deno.test("my implementation", () => {});\n';
    await writeTextFile(new URL("test/lib_test.ts", root), custom);
    await chmod(new URL("test/lib_test.ts", root), 0o755);
    assertEquals((await denoLibFeature.detect(context(root))).state, "enabled");
    assertEquals(
      (await denoLibFeature.checkEnable(context(root))).result,
      "no-op",
    );
    await writeTextFile(
      new URL("src/lib/mod.ts", root),
      "custom source\n",
    );
    const repair = await repairPlan(root);
    assert(
      !repair.changes.some((change) =>
        "path" in change && change.path === "test/lib_test.ts"
      ),
    );
    await applyLocalChangePlan(root, repair);
    const check = await denoLibFeature.checkDisable(context(root));
    assert(check.result === "allowed");
    await applyLocalChangePlan(
      root,
      await denoLibFeature.planDisable(context(root), check),
    );
    await apply(root);
    assertEquals(
      await readTextFile(new URL("test/lib_test.ts", root)),
      custom,
    );
    assertEquals(
      (await fixtureStat(new URL("test/lib_test.ts", root))).mode! & 0o777,
      0o755,
    );
  });
});

test("deno-lib keeps pre-existing tests without contributing an unused assertion import", async () => {
  await withRepository(async (root) => {
    await mkdir(new URL("test", root));
    await writeTextFile(
      new URL("test/lib_test.ts", root),
      "// project tests\n",
    );
    await apply(root);
    assertEquals(
      parse(await readTextFile(new URL("deno.jsonc", root))).imports,
      undefined,
    );
    assertEquals(
      await readTextFile(new URL("test/lib_test.ts", root)),
      "// project tests\n",
    );
  });
});

test("deno-lib repairs missing assertion mappings and blocks ambiguous imports before writes", async () => {
  for (const imports of [undefined, [], { "@std/assert": 7 }]) {
    await withRepository(async (root) => {
      await writeTextFile(
        new URL("deno.json", root),
        JSON.stringify({ exports: { ".": "./src/lib/mod.ts" }, imports }),
      );
      for (const directory of ["src/lib", "test"]) {
        await mkdir(new URL(directory, root), { recursive: true });
      }
      for (const artifact of denoLibArtifacts) {
        await writeTextFile(
          new URL(artifact.path, root),
          artifact.content,
        );
        await chmod(new URL(artifact.path, root), 0o644);
      }
      assertEquals(
        (await denoLibFeature.detect(context(root))).state,
        "drifted",
      );
      const check = await denoLibFeature.checkEnable(context(root));
      assertEquals(check.result, imports === undefined ? "allowed" : "blocked");
      if (check.result === "allowed") {
        await applyLocalChangePlan(
          root,
          await denoLibFeature.planEnable(context(root), check),
        );
        assertEquals(
          (await denoLibFeature.detect(context(root))).state,
          "enabled",
        );
      }
    });
  }
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
  const path = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-deno-lib-",
  });
  try {
    await action(new URL(`file://${path}/`));
  } finally {
    await remove(path, { recursive: true });
  }
}
