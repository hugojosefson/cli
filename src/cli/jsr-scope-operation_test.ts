import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { licenseCatalog } from "../features/license-catalog.ts";
import { createSpdxLicenseFeature } from "../features/license-spdx-feature.ts";
import { builtInFeatureRegistry } from "../features/built-in-feature-registry.ts";
import {
  withRepository,
  writeConfig,
} from "../features/jsr-package-feature-support.ts";
import type { JsrScopes } from "../repository/jsr-scope-reader.ts";
import { parseFeatures } from "./parse-features.ts";
import { runFeatureOperation } from "./run-features.ts";

const registry = {
  ...builtInFeatureRegistry,
  features: builtInFeatureRegistry.features.map((feature) =>
    feature.metadata.id === "license-mit"
      ? createSpdxLicenseFeature({
        ...licenseCatalog.find((item) => item.id === "license-mit")!,
        text: () => Promise.resolve("MIT <year> <copyright holders>\n"),
        alternates: [],
      })
      : feature
  ),
};

function run(
  root: URL,
  result: JsrScopes,
  flags: string[],
  prompt: () => string | null = () => {
    throw new Error("must not prompt");
  },
) {
  return runFeatureOperation(
    root,
    parseFeatures(
      ["repo", "features", "--jsr-package", "--deno-lib", ...flags],
      registry,
    ),
    registry,
    undefined,
    {
      jsrScopes: { scopes: () => Promise.resolve(result) },
      promptJsrScope: prompt,
      githubIdentity: {
        viewer: () => Promise.resolve({ name: "Test Author" }),
      },
    },
  );
}

Deno.test("JSR setup persists and reports the sole member scope, and repeat checks membership", async () => {
  await withRepository(async (root) => {
    const memberships: JsrScopes = {
      kind: "available",
      scopes: ["ordinary-member"],
    };
    const output = await run(root, memberships, ["--yes"]);
    const config = JSON.parse(
      await Deno.readTextFile(new URL("deno.jsonc", root)),
    );
    assertStringIncludes(config.name, "@ordinary-member/");
    // Tables wrap long names; verify the selected scope remains visible.
    assertStringIncludes(output, "@ordinary-member/");
    assertStringIncludes(
      await run(root, memberships, ["--yes"]),
      "No changes.",
    );
    await assertRejects(
      () =>
        run(root, { kind: "available", scopes: ["someone-else"] }, ["--yes"]),
      Error,
      "not a member",
    );
    await assertRejects(
      () => run(root, memberships, ["--yes", "--jsr-scope=another"]),
      Error,
      "conflicts",
    );
  });
});

Deno.test("JSR --yes never chooses among scopes or writes files after discovery failure", async () => {
  for (
    const result of [
      { kind: "available", scopes: ["first", "second"] },
      { kind: "available", scopes: [] },
      { kind: "missing-authentication" },
      { kind: "unavailable", observation: "HTTP 503" },
    ] as const
  ) {
    await withRepository(async (root) => {
      await assertRejects(() => run(root, result, ["--yes"]));
      assertEquals([...Deno.readDirSync(root)], []);
    });
  }
});

Deno.test("JSR explicit local setup preserves configured names without authentication", async () => {
  await withRepository(async (root) => {
    await writeConfig(root, { name: "@configured/my-library" });
    await run(root, { kind: "missing-authentication" }, ["--yes"]);
    const config = JSON.parse(
      await Deno.readTextFile(new URL("deno.json", root)),
    );
    assertEquals(config.name, "@configured/my-library");
  });
  await withRepository(async (root) => {
    await run(root, { kind: "missing-authentication" }, [
      "--yes",
      "--jsr-scope=explicit",
    ]);
    const config = JSON.parse(
      await Deno.readTextFile(new URL("deno.jsonc", root)),
    );
    assertStringIncludes(config.name, "@explicit/");
  });
});

Deno.test("JSR discovery completes partial metadata without requiring credentials for status", async () => {
  await withRepository(async (root) => {
    await writeConfig(root, { version: "1.2.3" });
    await run(root, { kind: "available", scopes: ["team"] }, ["--yes"]);
    const config = JSON.parse(
      await Deno.readTextFile(new URL("deno.json", root)),
    );
    assertStringIncludes(config.name, "@team/");
    assertEquals(config.version, "1.2.3");
    const status = await runFeatureOperation(
      root,
      parseFeatures(["repo", "features"], registry),
      registry,
      undefined,
      {
        jsrScopes: {
          scopes: () => {
            throw new Error("status must not authenticate");
          },
        },
      },
    );
    assertStringIncludes(status, "@team/");
  });
});

Deno.test("JSR setup requires a terminal selection when several memberships are available", async () => {
  await withRepository(async (root) => {
    await run(
      root,
      { kind: "available", scopes: ["first", "second"] },
      [],
      () => "second",
    );
    const config = JSON.parse(
      await Deno.readTextFile(new URL("deno.jsonc", root)),
    );
    assertStringIncludes(config.name, "@second/");
  });
});
