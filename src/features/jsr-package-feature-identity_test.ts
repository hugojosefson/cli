import { assertEquals } from "@std/assert";
import { jsrPackageFeature } from "./jsr-package-feature.ts";
import {
  context,
  withRepository,
  writeConfig,
} from "./jsr-package-feature-support.ts";
import { publishCheckDefinition } from "./jsr-package-config.ts";

Deno.test("jsr-package classifies conflicting identity, malformed version, and missing exports", async () => {
  for (
    const [name, version, exports] of [
      ["@other/repository", "1.0.0", { ".": "./mod.ts" }],
      ["@owner/repository", "version", { ".": "./mod.ts" }],
      ["@owner/repository", "1.0.0", undefined],
    ] as const
  ) {
    await withRepository(async (root) => {
      await Deno.writeTextFile(
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

Deno.test("jsr-package rejects a wrong name even without a publish task", async () => {
  await withRepository(async (root) => {
    await writeConfig(root, { name: "@other/repository", version: "1.0.0" });
    assertEquals(
      (await jsrPackageFeature.detect(context(root))).state,
      "ambiguous",
    );
  });
});

Deno.test("jsr-package rejects malformed metadata and disables valid metadata without a task", async () => {
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
