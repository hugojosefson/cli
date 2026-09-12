import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import {
  mkdir,
  readTextFile,
  remove,
  writeTextFile,
} from "../testing/files-test-fixtures.ts";
import { assertEquals, assertStringIncludes } from "@std/assert";
import { configuredDenoTask } from "./configured-deno-task.ts";
import {
  configuredDenoCli,
  localModulePath,
} from "./configured-deno-export.ts";
import { denoCliFeature } from "./deno-cli-feature.ts";
import { denoLibFeature } from "./deno-lib-feature.ts";
import { denoFmtFeature } from "./deno-fmt-feature.ts";
import { denoTestFeature } from "./deno-task-features.ts";
import { jsrPackageFeature } from "./jsr-package-feature.ts";
import {
  context,
  withRepository,
  writeConfig,
} from "./jsr-package-test-fixtures.ts";
import type { JsonObject } from "../api/json.ts";

test("configured tasks recognize Deno commands, wrappers, aliases, and dependencies", async () => {
  await withRepository(async (root) => {
    await writeTextFile(
      new URL("test runner.ts", root),
      'throw new Error("must not execute");',
    );
    const current = context(root);
    for (
      const task of [
        "deno test --frozen src",
        { description: "custom", command: "deno test" },
        'deno run --allow-read "test runner.ts"',
        "deno task unit",
        { dependencies: ["unit"] },
        { command: "deno test", dependencies: ["unit"] },
      ]
    ) {
      assertEquals(
        await configuredDenoTask(
          current,
          { test: task, unit: "deno test" } as JsonObject,
          "test",
          "test",
        ),
        true,
      );
    }
    for (
      const task of [
        undefined,
        7,
        {},
        "",
        "echo TODO",
        "deno lint",
        "deno test --help",
        "deno test && echo done",
        'deno test "unterminated',
        "deno task missing",
        "deno task test",
        "deno run missing.ts",
        "deno run ../outside.ts",
        "deno run file.json",
        "deno run --allow-read",
        { dependencies: [7] },
        { dependencies: [] },
        { dependencies: "unit" },
      ]
    ) {
      assertEquals(
        await configuredDenoTask(
          current,
          { test: task } as JsonObject,
          "test",
          "test",
        ),
        false,
        JSON.stringify(task),
      );
    }
    assertEquals(
      await configuredDenoTask(
        current,
        { test: "deno task unit", unit: "deno task test" },
        "test",
        "test",
      ),
      false,
    );
    assertEquals(
      await configuredDenoTask(
        current,
        { format: "deno task format-check", "format-check": "deno fmt" },
        "format",
        "fmt",
      ),
      false,
    );
    assertEquals(
      await configuredDenoTask(
        current,
        { format: "deno fmt --check src" },
        "format",
        "fmt",
      ),
      true,
    );
    for (
      const command of [
        "deno publish",
        "deno publish -- --dry-run",
        "deno publish --dry-run --help",
      ]
    ) {
      assertEquals(
        await configuredDenoTask(
          current,
          { "publish-check": command },
          "publish-check",
          "publish",
        ),
        false,
      );
    }
  });
});

test("custom local features are enabled and requests preserve their files", async () => {
  await withRepository(async (root) => {
    await writeTextFile(
      new URL("runner.ts", root),
      'throw new Error("must not execute");',
    );
    const value = {
      name: "@personal/cli",
      version: "0.0.0",
      exports: { ".": "./runner.ts", "./cli": "./runner.ts" },
      tasks: {
        fmt: "deno fmt",
        format: "deno fmt --check",
        test: "deno run runner.ts",
        "publish-check": "deno run runner.ts",
      },
    };
    await writeConfig(root, value);
    const current = {
      ...context(root),
      github: undefined,
      resolvedChanges: [],
    };
    const before = await readTextFile(new URL("deno.json", root));
    for (
      const feature of [
        denoCliFeature,
        denoFmtFeature,
        denoTestFeature,
        jsrPackageFeature,
      ]
    ) {
      assertEquals(
        (await feature.detect(current)).state,
        "enabled",
        feature.metadata.id,
      );
      assertEquals(
        (await feature.checkEnable(current)).result,
        "no-op",
        feature.metadata.id,
      );
    }
    assertEquals((await denoLibFeature.detect(current)).state, "disabled");
    assertEquals(
      (await denoFmtFeature.checkDisable(current)).result,
      "blocked",
    );
    assertEquals(
      (await denoTestFeature.checkDisable(current)).result,
      "blocked",
    );
    assertEquals(
      (await jsrPackageFeature.checkDisable(current)).result,
      "blocked",
    );
    assertEquals(
      (await denoCliFeature.checkDisable(current)).result,
      "blocked",
    );
    assertEquals(await readTextFile(new URL("deno.json", root)), before);
    await remove(new URL("runner.ts", root));
    assertEquals((await denoCliFeature.detect(current)).state, "drifted");
    assertEquals((await denoTestFeature.detect(current)).state, "drifted");
    assertEquals((await jsrPackageFeature.detect(current)).state, "drifted");
  });
});

test("entry point detection rejects unsafe, empty, and non-file exports", async () => {
  await withRepository(async (root) => {
    const current = context(root);
    assertEquals(await configuredDenoCli(current, undefined), false);
    for (
      const target of [
        42,
        "outside.ts",
        "../outside.ts",
        "./../outside.ts",
        "./a//b.ts",
        "./a/./b.ts",
        "./a\\b.ts",
        "./a\0b.ts",
        "./https://example.com/a.ts",
      ]
    ) {
      assertEquals(localModulePath(target), undefined);
      await writeConfig(root, { exports: { "./cli": target } });
      assertEquals((await denoCliFeature.detect(current)).state, "ambiguous");
    }
    await writeTextFile(new URL("empty.ts", root), " ");
    await writeConfig(root, { exports: { "./cli": "./empty.ts" } });
    assertEquals((await denoCliFeature.detect(current)).state, "drifted");
    await remove(new URL("empty.ts", root));
    await mkdir(new URL("empty.ts", root));
    assertEquals((await denoCliFeature.detect(current)).state, "ambiguous");
    await writeConfig(root, {
      name: "@owner/repository",
      version: "1.0.0",
      exports: { ".": "./ok.ts", "bad": "../escape.ts" },
      tasks: { "publish-check": "deno publish --dry-run" },
    });
    const result = await jsrPackageFeature.detect(current);
    assertEquals(result.state, "drifted");
    assertStringIncludes(
      "issues" in result ? result.issues[0].observation : "",
      "export",
    );
  });
});
