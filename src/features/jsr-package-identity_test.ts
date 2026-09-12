import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import { mkdir } from "../testing/files-test-fixtures.ts";
import { assertEquals, assertStringIncludes } from "@std/assert";
import { jsrPackageIdentity } from "./jsr-package-identity.ts";
import {
  context,
  withRepository,
  writeConfig,
} from "./jsr-package-test-fixtures.ts";

test("JSR identity keeps configured package names independently of GitHub", async () => {
  await withRepository(async (root) => {
    await writeConfig(root, { name: "@another/deno-original" });
    assertEquals(
      await jsrPackageIdentity({ ...context(root), github: undefined }),
      {
        kind: "available",
        name: "@another/deno-original",
      },
    );
  });
});

test("JSR identity normalizes only a missing package component from the starting directory", async () => {
  await withRepository(async (parent) => {
    const root = new URL("deno%20Fancy_Tool/", parent);
    await mkdir(root);
    assertEquals(await jsrPackageIdentity(context(root)), {
      kind: "available",
      name: "@owner/fancy-tool",
    });
    assertEquals(
      (await jsrPackageIdentity({ ...context(root), options: {} })).kind,
      "unavailable",
    );
  });
});

test("JSR identity requires explicit input for invalid fallback and scope", async () => {
  await withRepository(async (parent) => {
    for (const name of ["deno", "deno___", "x", "a".repeat(59)]) {
      const root = new URL(name + "/", parent);
      await mkdir(root);
      const identity = await jsrPackageIdentity(context(root));
      assertEquals(identity.kind, "unavailable");
      if (identity.kind === "unavailable") {
        assertStringIncludes(identity.observation, "explicit");
      }
    }
    const current = context(parent);
    assertEquals(
      (await jsrPackageIdentity({
        ...current,
        options: { jsrScope: "bad_owner" },
      })).kind,
      "unavailable",
    );
    await writeConfig(parent, { name: "unscoped" });
    assertEquals(
      (await jsrPackageIdentity(context(parent))).kind,
      "unavailable",
    );
  });
});
