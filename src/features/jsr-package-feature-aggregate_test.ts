import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import { assertEquals } from "@std/assert";
import { denoFmtFeature } from "./deno-fmt-feature.ts";
import { denoLintFeature } from "./deno-task-features.ts";
import { denoTaskDefinitions, leafTaskDefinitions } from "./deno-tasks.ts";
import { jsrPackageFeature } from "./jsr-package-feature.ts";
import {
  context,
  ownedTasks,
  withRepository,
  writeConfig,
} from "./jsr-package-test-fixtures.ts";

for (
  const leafs of [
    [],
    ["deno-lint"],
    ["deno-typecheck"],
    ["deno-test"],
    ["deno-lint", "deno-typecheck"],
    ["deno-lint", "deno-test"],
    ["deno-typecheck", "deno-test"],
    ["deno-lint", "deno-typecheck", "deno-test"],
  ] as const
) {
  for (const readme of [false, true]) {
    test(`jsr-package recognizes local configuration with custom aggregates for ${leafs.join(",") || "no"} leaf tasks and readme ${readme}`, async () => {
      await withRepository(async (root) => {
        const tasks = ownedTasks(leafs, readme);
        await writeConfig(root, {
          name: "@owner/repository",
          version: "1.0.0",
          exports: { ".": "./mod.ts" },
          tasks,
        });
        assertEquals(
          (await jsrPackageFeature.detect(context(root))).state,
          "enabled",
        );
        tasks.check = { dependencies: ["publish-check"] };
        await writeConfig(root, {
          name: "@owner/repository",
          version: "1.0.0",
          exports: { ".": "./mod.ts" },
          tasks,
        });
        assertEquals(
          (await jsrPackageFeature.detect(context(root))).state,
          "enabled",
        );
        assertEquals(
          (await jsrPackageFeature.checkDisable(context(root))).result,
          "blocked",
        );
      });
    });
  }
}

test("JSR aggregate remains exact for Deno formatting and leaf tasks", async () => {
  await withRepository(async (root) => {
    await writeConfig(root, {
      name: "@owner/repository",
      version: "1.0.0",
      exports: { ".": "./mod.ts" },
      fmt: { exclude: ["coverage"] },
      tasks: {
        ...denoTaskDefinitions(["deno-lint"], false, true),
        lint: leafTaskDefinitions["deno-lint"],
      },
    });
    const current = context(root);
    assertEquals((await jsrPackageFeature.detect(current)).state, "enabled");
    assertEquals((await denoFmtFeature.detect(current)).state, "enabled");
    assertEquals((await denoLintFeature.detect(current)).state, "enabled");
  });
});
