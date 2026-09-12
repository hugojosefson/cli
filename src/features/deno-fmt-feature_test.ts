import { isNotFound } from "../runtime/errors.ts";
import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import {
  makeTempDir,
  readTextFile,
  remove,
  writeTextFile,
} from "../testing/files-test-fixtures.ts";
import { assert, assertEquals } from "@std/assert";
import type { OperationContext } from "../api/repository-context.ts";
import { applyLocalChangePlan } from "../operations/local-change-plan.ts";
import { LocalFileReader } from "../repository/local-file-reader.ts";
import { denoFmtFeature } from "./deno-fmt-feature.ts";
import {
  denoFmtConfigText,
  denoTaskDefinitions,
  inspectDenoTasks,
} from "./deno-tasks.ts";

test("deno tasks distinguish missing, drifted, and ambiguous definitions", () => {
  assertEquals(inspectDenoTasks({}), { kind: "missing-tasks" });
  assertEquals(inspectDenoTasks({ tasks: [] }).kind, "ambiguous-tasks");
  assertEquals(
    inspectDenoTasks({ tasks: { fmt: { command: "deno fmt" } } }),
    {
      kind: "tasks",
      values: { fmt: { command: "deno fmt" } },
      missing: ["format", "check", "default", "all"],
      drifted: ["fmt"],
      ambiguous: [],
    },
  );
  assertEquals(
    inspectDenoTasks({ tasks: { ...denoTaskDefinitions(), check: "wrong" } })
      .kind,
    "tasks",
  );
});

test("deno-fmt creates, adopts, and removes its exact standalone config without Git", async () => {
  await withRepository(async (root) => {
    const absent = context(root);
    assertEquals((await denoFmtFeature.detect(absent)).state, "disabled");
    const enable = await denoFmtFeature.checkEnable(absent);
    assertEquals(enable.result, "allowed");
    if (enable.result !== "allowed") {
      throw new Error("test setup requires enable");
    }
    await applyLocalChangePlan(
      root,
      await denoFmtFeature.planEnable(absent, enable),
    );
    assertEquals(await text(root, "deno.jsonc"), denoFmtConfigText());
    assertEquals((await denoFmtFeature.detect(context(root))).state, "enabled");

    const disable = await denoFmtFeature.checkDisable(context(root));
    assertEquals(disable.result, "allowed");
    if (disable.result !== "allowed") {
      throw new Error("test setup requires disable");
    }
    await applyLocalChangePlan(
      root,
      await denoFmtFeature.planDisable(context(root), disable),
    );
    assertEquals(await text(root, "deno.jsonc"), undefined);
  });
});

test("deno-fmt edits a selected JSONC config and preserves unrelated content", async () => {
  await withRepository(async (root) => {
    await writeTextFile(
      new URL("deno.jsonc", root),
      '{\n  // keep this comment\n  "name": "example",\n  "tasks": { "custom": "deno test" }\n}\n',
    );
    assertEquals(
      (await denoFmtFeature.detect(context(root))).state,
      "disabled",
    );
    const enable = await denoFmtFeature.checkEnable(context(root));
    assertEquals(enable.result, "allowed");
    if (enable.result !== "allowed") {
      throw new Error("test setup requires enable");
    }
    await applyLocalChangePlan(
      root,
      await denoFmtFeature.planEnable(context(root), enable),
    );
    const configured = (await text(root, "deno.jsonc"))!;
    assert(configured.includes("// keep this comment"));
    assert(configured.includes('"name": "example"'));
    assert(configured.includes('"custom": "deno test"'));

    const disable = await denoFmtFeature.checkDisable(context(root));
    assertEquals(disable.result, "allowed");
    if (disable.result !== "allowed") {
      throw new Error("test setup requires disable");
    }
    await applyLocalChangePlan(
      root,
      await denoFmtFeature.planDisable(context(root), disable),
    );
    const disabled = (await text(root, "deno.jsonc"))!;
    assert(disabled.includes("// keep this comment"));
    assert(disabled.includes('"custom": "deno test"'));
    assert(!disabled.includes('"fmt"'));
    assertEquals(
      (await denoFmtFeature.detect(context(root))).state,
      "disabled",
    );
  });
});

test("deno-fmt fills an existing deno.json instead of creating deno.jsonc", async () => {
  await withRepository(async (root) => {
    await writeTextFile(
      new URL("deno.json", root),
      '{ "name": "example" }\n',
    );
    assertEquals(
      (await denoFmtFeature.detect(context(root))).state,
      "disabled",
    );
    const enable = await denoFmtFeature.checkEnable(context(root));
    assertEquals(enable.result, "allowed");
    if (enable.result !== "allowed") {
      throw new Error("test setup requires enable");
    }
    const plan = await denoFmtFeature.planEnable(context(root), enable);
    assertEquals(plan.changes[0].kind, "set-json");
    await applyLocalChangePlan(root, plan);
    assertEquals(await text(root, "deno.jsonc"), undefined);
    assertEquals((await denoFmtFeature.detect(context(root))).state, "enabled");
  });
});

test("deno-fmt blocks ambiguous configs and repairs selected task drift", async () => {
  await withRepository(async (root) => {
    await writeTextFile(new URL("deno.json", root), "{}\n");
    await writeTextFile(new URL("deno.jsonc", root), "{}\n");
    assertEquals(
      (await denoFmtFeature.detect(context(root))).state,
      "ambiguous",
    );
    assertEquals(
      (await denoFmtFeature.checkEnable(context(root))).result,
      "blocked",
    );
  });
  await withRepository(async (root) => {
    await writeTextFile(
      new URL("deno.json", root),
      JSON.stringify({
        tasks: { ...denoTaskDefinitions(), fmt: { command: "prettier" } },
      }),
    );
    assertEquals((await denoFmtFeature.detect(context(root))).state, "drifted");
    assertEquals(
      (await denoFmtFeature.checkEnable(context(root))).result,
      "blocked",
    );
    const repair = context(root, {
      kind: "features",
      featureIds: ["deno-fmt"],
    });
    const enable = await denoFmtFeature.checkEnable(repair);
    assertEquals(enable.result, "allowed");
    if (enable.result !== "allowed") {
      throw new Error("test setup requires repair");
    }
    await applyLocalChangePlan(
      root,
      await denoFmtFeature.planEnable(repair, enable),
    );
    assertEquals((await denoFmtFeature.detect(context(root))).state, "enabled");
  });
});

function context(
  root: URL,
  repair: OperationContext["repair"] = undefined,
): OperationContext {
  const files = new LocalFileReader(root);
  return {
    repositoryRoot: root,
    files,
    git: {
      isRepository: () =>
        Promise.reject(new Error("deno-fmt must not use Git")),
      head: () => Promise.reject(new Error("deno-fmt must not use Git")),
      status: () => Promise.reject(new Error("deno-fmt must not use Git")),
      remotes: () => Promise.reject(new Error("deno-fmt must not use Git")),
      defaultBranch: () =>
        Promise.reject(new Error("deno-fmt must not use Git")),
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
    prefix: "hj-deno-fmt-",
  });
  try {
    await action(new URL(`file://${path}/`));
  } finally {
    await remove(path, { recursive: true });
  }
}

async function text(root: URL, path: string): Promise<string | undefined> {
  try {
    return await readTextFile(new URL(path, root));
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}
