import { assertEquals, assertStringIncludes } from "@std/assert";
import { jsrPackageIdentity } from "./jsr-package-identity.ts";
import {
  context,
  withRepository,
  writeConfig,
} from "./jsr-package-feature-support.ts";

Deno.test("JSR identity keeps configured package names independently of GitHub", async () => {
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

Deno.test("JSR identity normalizes only a missing package component from the starting directory", async () => {
  await withRepository(async (parent) => {
    const root = new URL("deno%20Fancy_Tool/", parent);
    await Deno.mkdir(root);
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

Deno.test("JSR identity requires explicit input for invalid fallback and scope", async () => {
  await withRepository(async (parent) => {
    for (const name of ["deno", "deno___", "x", "a".repeat(59)]) {
      const root = new URL(name + "/", parent);
      await Deno.mkdir(root);
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
