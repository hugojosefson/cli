import { assert, assertEquals, assertRejects } from "@std/assert";
import { applyLocalChangePlan } from "../operations/local-change-plan.ts";
import { jsrPackageFeature } from "./jsr-package-feature.ts";
import {
  context,
  ownedTasks,
  withRepository,
  writeConfig,
} from "./jsr-package-feature-support.ts";

Deno.test("jsr-package adopts SemVer, preserves JSONC, repairs exact drift, and disables without metadata removal", async () => {
  await withRepository(async (root) => {
    await Deno.writeTextFile(
      new URL("deno.jsonc", root),
      `{
  // retain this comment
  "name": "@owner/repository",
  "version": "1.2.3-beta.1",
  "exports": { ".": "./mod.ts" },
  "tasks": { "check": { "dependencies": ["format"] } }
}
`,
    );
    let current = context(root);
    assertEquals((await jsrPackageFeature.detect(current)).state, "disabled");
    const enable = await jsrPackageFeature.checkEnable(current);
    assertEquals(enable.result, "allowed");
    if (enable.result !== "allowed") throw new Error("expected JSR enable");
    await applyLocalChangePlan(
      root,
      await jsrPackageFeature.planEnable(current, enable),
    );
    const configured = await Deno.readTextFile(new URL("deno.jsonc", root));
    assert(configured.includes("// retain this comment"));
    assert(configured.includes('"version": "1.2.3-beta.1"'));
    assertEquals(
      (await jsrPackageFeature.detect(context(root))).state,
      "enabled",
    );
    await Deno.writeTextFile(
      new URL("deno.jsonc", root),
      configured.replace("deno publish --dry-run --check=all", "deno publish"),
    );
    current = context(root);
    assertEquals((await jsrPackageFeature.detect(current)).state, "drifted");
    assertEquals(
      (await jsrPackageFeature.checkEnable(current)).result,
      "blocked",
    );
    const repair = context(root, {
      kind: "features",
      featureIds: ["jsr-package"],
    });
    const repaired = await jsrPackageFeature.checkEnable(repair);
    assertEquals(repaired.result, "allowed");
    if (repaired.result !== "allowed") throw new Error("expected JSR repair");
    await applyLocalChangePlan(
      root,
      await jsrPackageFeature.planEnable(repair, repaired),
    );
    const disable = await jsrPackageFeature.checkDisable(context(root));
    assertEquals(disable.result, "allowed");
    if (disable.result !== "allowed") throw new Error("expected JSR disable");
    await applyLocalChangePlan(
      root,
      await jsrPackageFeature.planDisable(context(root), disable),
    );
    const disabled = await Deno.readTextFile(new URL("deno.jsonc", root));
    assert(disabled.includes('"name": "@owner/repository"'));
    assert(disabled.includes('"version": "1.2.3-beta.1"'));
    assert(!disabled.includes("publish-check"));
  });
});

Deno.test("jsr-package safely adds missing metadata to an owned task", async () => {
  await withRepository(async (root) => {
    await writeConfig(root, {
      exports: { ".": "./mod.ts" },
      tasks: ownedTasks(),
    });
    const current = context(root);
    assertEquals((await jsrPackageFeature.detect(current)).state, "drifted");
    const allowed = await jsrPackageFeature.checkEnable(current);
    assertEquals(allowed.result, "allowed");
    if (allowed.result !== "allowed") throw new Error("expected enable");
    const changes =
      (await jsrPackageFeature.planEnable(current, allowed)).changes;
    assertEquals(
      changes.map((change) =>
        change.kind === "set-json" ? change.jsonPath.join(".") : ""
      ),
      ["name", "version"],
    );
  });
});

for (const provider of [false, true]) {
  Deno.test(`jsr-package ${provider ? "allows" : "blocks"} missing exports ${provider ? "with" : "without"} an enabling provider`, async () => {
    await withRepository(async (root) => {
      await writeConfig(root, {
        name: "@owner/repository",
        version: "1.0.0",
        tasks: ownedTasks(),
      });
      assertEquals(
        (await jsrPackageFeature.detect(context(root))).state,
        "drifted",
      );
      assertEquals(
        await jsrPackageFeature.checkEnable(
          context(root, undefined, provider ? ["deno-lib"] : []),
        ).then((check) => check.result),
        provider ? "allowed" : "blocked",
      );
    });
  });
}

Deno.test("jsr-package composes metadata while deno-fmt owns newly absent tasks", async () => {
  await withRepository(async (root) => {
    await writeConfig(root, { exports: { ".": "./mod.ts" } });
    const allowed = await jsrPackageFeature.checkEnable(
      context(root, undefined, ["deno-fmt"]),
    );
    assertEquals(allowed.result, "allowed");
    if (allowed.result !== "allowed") throw new Error("expected enable");
    const changes = await jsrPackageFeature.planEnable(
      context(root, undefined, ["deno-fmt"]),
      allowed,
    );
    assertEquals(
      changes.changes.map((change) =>
        change.kind === "set-json" ? change.jsonPath.join(".") : ""
      ),
      ["name", "version"],
    );
  });
});

Deno.test("jsr-package repair preserves custom task keys", async () => {
  await withRepository(async (root) => {
    await writeConfig(root, {
      name: "@owner/repository",
      version: "1.0.0",
      exports: { ".": "./mod.ts" },
      tasks: {
        ...ownedTasks(),
        custom: { command: "custom" },
        check: { dependencies: ["wrong"] },
      },
    });
    const current = context(root, {
      kind: "features",
      featureIds: ["jsr-package"],
    });
    const allowed = await jsrPackageFeature.checkEnable(current);
    assertEquals(allowed.result, "allowed");
    if (allowed.result !== "allowed") throw new Error("expected repair");
    await applyLocalChangePlan(
      root,
      await jsrPackageFeature.planEnable(current, allowed),
    );
    assert(
      (await Deno.readTextFile(new URL("deno.json", root))).includes(
        '"custom"',
      ),
    );
  });
});

for (const drift of ["publish-check", "check"] as const) {
  Deno.test(`jsr-package gates ${drift} repair independently`, async () => {
    await withRepository(async (root) => {
      const tasks = ownedTasks();
      tasks[drift] = drift === "check"
        ? { dependencies: [] }
        : { command: "deno publish" };
      await writeConfig(root, {
        name: "@owner/repository",
        version: "1.0.0",
        exports: { ".": "./mod.ts" },
        tasks,
      });
      assertEquals(
        (await jsrPackageFeature.checkEnable(context(root))).result,
        "blocked",
      );
      assertEquals(
        (await jsrPackageFeature.checkEnable(
          context(root, { kind: "all-drifted" }),
        )).result,
        "allowed",
      );
    });
  });
}

Deno.test("jsr-package disable preserves metadata, custom tasks, and comments", async () => {
  await withRepository(async (root) => {
    const tasks = { ...ownedTasks(), custom: { command: "custom" } };
    await Deno.writeTextFile(
      new URL("deno.jsonc", root),
      `// retained\n${
        JSON.stringify(
          {
            name: "@owner/repository",
            version: "1.0.0",
            exports: { ".": "./mod.ts" },
            tasks,
          },
          null,
          2,
        )
      }\n`,
    );
    const current = context(root, undefined, [], false);
    const allowed = await jsrPackageFeature.checkDisable(current);
    assertEquals(allowed.result, "allowed");
    if (allowed.result !== "allowed") throw new Error("expected disable");
    await applyLocalChangePlan(
      root,
      await jsrPackageFeature.planDisable(current, allowed),
    );
    const text = await Deno.readTextFile(new URL("deno.jsonc", root));
    assert(
      text.includes("// retained") && text.includes('"custom"') &&
        text.includes('"name"'),
    );
    assert(!text.includes("publish-check"));
  });
});

Deno.test("jsr-package plan rejects new task drift after its check", async () => {
  await withRepository(async (root) => {
    await writeConfig(root, {
      exports: { ".": "./mod.ts" },
      tasks: ownedTasks(),
    });
    const current = context(root);
    const allowed = await jsrPackageFeature.checkEnable(current);
    assertEquals(allowed.result, "allowed");
    if (allowed.result !== "allowed") throw new Error("expected repair");
    await writeConfig(root, {
      exports: { ".": "./mod.ts" },
      tasks: { ...ownedTasks(), "publish-check": { command: "changed" } },
    });
    await assertRejects(() => jsrPackageFeature.planEnable(current, allowed));
  });
});
