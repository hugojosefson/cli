import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import { readTextFile, writeTextFile } from "../testing/files-test-fixtures.ts";
import { assertEquals } from "@std/assert";
import { jsrPackageFeature } from "./jsr-package-feature.ts";
import {
  context,
  withRepository,
  writeConfig,
} from "./jsr-package-test-fixtures.ts";
import { publishCheckDefinition } from "./jsr-package-config.ts";

test("jsr-package accepts a distinct local name but rejects malformed metadata", async () => {
  for (
    const [name, version, exports] of [
      ["@Other/invalid", "1.0.0", { ".": "./mod.ts" }],
      ["@owner/repository", "version", { ".": "./mod.ts" }],
      ["@owner/repository", "1.0.0", undefined],
    ] as const
  ) {
    await withRepository(async (root) => {
      await writeTextFile(
        new URL("deno.json", root),
        JSON.stringify({
          name,
          version,
          exports,
          tasks: {
            "publish-check": publishCheckDefinition,
            check: { dependencies: ["publish-check"] },
          },
        }),
      );
      assertEquals(
        (await jsrPackageFeature.detect(context(root))).state,
        exports === undefined ? "drifted" : "ambiguous",
      );
    });
  }
});

test("jsr-package allows a distinct package name without assuming a publishing task", async () => {
  await withRepository(async (root) => {
    await writeConfig(root, { name: "@other/repository", version: "1.0.0" });
    assertEquals(
      (await jsrPackageFeature.detect(context(root))).state,
      "disabled",
    );
  });
});

test("jsr-package rejects malformed metadata and disables valid metadata without a task", async () => {
  await withRepository(async (root) => {
    await writeConfig(root, { name: "@owner/repository", version: "bad" });
    assertEquals(
      (await jsrPackageFeature.detect(context(root))).state,
      "ambiguous",
    );
    await writeConfig(root, { name: "@owner/repository", version: "1.0.0" });
    assertEquals(
      (await jsrPackageFeature.detect(context(root))).state,
      "disabled",
    );
  });
});

test("JSR adoption and removal preserve a configured name that differs from GitHub", async () => {
  await withRepository(async (root) => {
    const { applyLocalChangePlan } = await import(
      "../operations/local-change-plan.ts"
    );
    await writeConfig(root, {
      name: "@different/deno-unchanged",
      version: "1.0.0",
      exports: "./mod.ts",
    });
    const current = { ...context(root), github: undefined };
    const enable = await jsrPackageFeature.checkEnable(current);
    if (enable.result !== "allowed") throw new Error(JSON.stringify(enable));
    await applyLocalChangePlan(
      root,
      await jsrPackageFeature.planEnable(current, enable),
    );
    const disable = await jsrPackageFeature.checkDisable(current);
    if (disable.result !== "allowed") throw new Error(JSON.stringify(disable));
    await applyLocalChangePlan(
      root,
      await jsrPackageFeature.planDisable(current, disable),
    );
    assertEquals(
      JSON.parse(await readTextFile(new URL("deno.json", root))).name,
      "@different/deno-unchanged",
    );
  });
});
