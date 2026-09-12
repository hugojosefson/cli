import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import type { ChangePlan } from "../api/change-plan.ts";
import type { OperationContext } from "../api/repository-context.ts";
import { applyLocalChangePlan } from "../operations/local-change-plan.ts";
import { LocalFileReader } from "../repository/local-file-reader.ts";
import {
  gitIgnoreContent,
  gitIgnoreRequirements,
} from "./git-ignore-content.ts";
import {
  gitIgnoreFeature,
  reconcileGitIgnorePlans,
} from "./git-ignore-feature.ts";

Deno.test("git-ignore enables independently, repeats without changes, and removes owned file", async () => {
  await repository(async (context) => {
    assertEquals((await gitIgnoreFeature.detect(context)).state, "disabled");
    await apply(context, true);
    assertEquals((await gitIgnoreFeature.detect(context)).state, "enabled");
    assertEquals(
      await context.files.readText(".gitignore"),
      "# hj:git-ignore\n# hj:git-ignore .*.swp\n.*.swp\n",
    );
    assertEquals((await gitIgnoreFeature.checkEnable(context)).result, "no-op");
    await apply(context, false);
    assertEquals(await context.files.readText(".gitignore"), undefined);
    assertEquals((await gitIgnoreFeature.detect(context)).state, "disabled");
    assertEquals(
      (await gitIgnoreFeature.checkDisable(context)).result,
      "no-op",
    );
  });
});

Deno.test("git-ignore preserves custom bytes, duplicate patterns, edits, and mode", async () => {
  await repository(async (context) => {
    const initial =
      "# user entries\r\n/coverage/\r\n.*.swp\r\n!important.log\r\n";
    await write(context, ".gitignore", initial);
    await Deno.chmod(new URL(".gitignore", context.repositoryRoot), 0o600);
    await write(
      context,
      "deno.jsonc",
      '{ // coverage\n "tasks": { "test": "deno test --coverage=coverage" }, "nodeModulesDir": "auto" }',
    );
    await apply(context, true);
    let content = (await context.files.readText(".gitignore"))!;
    assert(content.startsWith(initial));
    assertEquals(content.match(/^\/coverage\/$/gm)?.length, 1);
    assertEquals(await context.files.mode(".gitignore"), 0o600);
    content = content.replace("\r\n/node_modules/\r\n", "\r\n/vendor/\r\n");
    await write(context, ".gitignore", content);
    assertEquals((await gitIgnoreFeature.detect(context)).state, "drifted");
    await apply(context, false);
    assertEquals(
      await context.files.readText(".gitignore"),
      initial + "/vendor/\r\n",
    );
    assertEquals((await gitIgnoreFeature.detect(context)).state, "disabled");
    await apply(context, true);
    assertStringIncludes(
      (await context.files.readText(".gitignore"))!,
      "/vendor/\r\n",
    );
    assertEquals((await gitIgnoreFeature.detect(context)).state, "enabled");
  });
});

Deno.test("git-ignore requirements follow coverage targets and node_modules configuration", async () => {
  await repository(async (context) => {
    for (
      const command of [
        "deno test --coverage=coverage",
        "deno test --coverage=./coverage/",
        'deno test --coverage="coverage"',
        "deno test --coverage='coverage'",
        "deno test --coverage --allow-read",
      ]
    ) {
      await write(
        context,
        "deno.json",
        JSON.stringify({ tasks: { test: { command } } }),
      );
      assertEquals((await gitIgnoreRequirements(context)).patterns, [
        ".*.swp",
        "/coverage/",
      ]);
    }
    for (
      const command of [
        "deno test --watch",
        "deno test --coverage=.coverage",
        "deno coverage coverage",
        "deno test --coverage-raw-data-only",
      ]
    ) {
      await write(
        context,
        "deno.json",
        JSON.stringify({ tasks: { test: command, ignored: 123 } }),
      );
      assertEquals((await gitIgnoreRequirements(context)).patterns, [".*.swp"]);
    }
    for (
      const nodeModulesDir of [true, "auto", "manual", false, "none", undefined]
    ) {
      await write(context, "deno.json", JSON.stringify({ nodeModulesDir }));
      assertEquals(
        (await gitIgnoreRequirements(context)).patterns.includes(
          "/node_modules/",
        ),
        [true, "auto", "manual"].includes(nodeModulesDir!),
      );
    }
    await write(context, "deno.json", "{}");
    await write(
      context,
      "package.json",
      '{"scripts":{"test":"vitest --coverage"}}',
    );
    assertEquals((await gitIgnoreRequirements(context)).patterns, [
      ".*.swp",
      "/coverage/",
      "/node_modules/",
    ]);
    await write(context, "deno.json", '{"nodeModulesDir":"none"}');
    assertEquals((await gitIgnoreRequirements(context)).patterns, [
      ".*.swp",
      "/coverage/",
    ]);
    await write(context, "deno.json", "{}");
    await write(
      context,
      "package.json",
      JSON.stringify({ installConfig: { pnp: true } }),
    );
    assertEquals((await gitIgnoreRequirements(context)).patterns, [".*.swp"]);
  });
});

Deno.test("git-ignore blocks conflicting files and configs, but removal preserves custom entries", async () => {
  await repository(async (context) => {
    await Deno.mkdir(new URL(".gitignore", context.repositoryRoot));
    assertEquals((await gitIgnoreFeature.detect(context)).state, "ambiguous");
    assertEquals(
      (await gitIgnoreFeature.checkEnable(context)).result,
      "blocked",
    );
    await Deno.remove(new URL(".gitignore", context.repositoryRoot));
    await apply(context, true);
    for (const content of ["invalid", "[]"]) {
      await write(context, "deno.json", content);
      assertEquals((await gitIgnoreFeature.detect(context)).state, "ambiguous");
      assertEquals(
        (await gitIgnoreFeature.checkEnable(context)).result,
        "blocked",
      );
    }
    await write(context, "deno.json", "{}");
    await write(context, "deno.jsonc", "{}");
    assertEquals(
      (await gitIgnoreFeature.checkEnable(context)).result,
      "blocked",
    );
    await apply(context, false);
    await Deno.remove(new URL("deno.jsonc", context.repositoryRoot));
    await Deno.remove(new URL("deno.json", context.repositoryRoot));
    await Deno.mkdir(new URL("package.json", context.repositoryRoot));
    assertEquals(
      (await gitIgnoreFeature.checkEnable(context)).result,
      "blocked",
    );
  });
});

Deno.test("git-ignore rejects stale ignore or configuration before writing", async () => {
  await repository(async (context) => {
    const check = await gitIgnoreFeature.checkEnable(context);
    assert(check.result === "allowed");
    const plan = await gitIgnoreFeature.planEnable(context, check);
    await write(context, "deno.json", '{"nodeModulesDir":"auto"}');
    await assertRejects(() =>
      applyLocalChangePlan(context.repositoryRoot, plan)
    );
    assertEquals(await context.files.readText(".gitignore"), undefined);
    await Deno.remove(new URL("deno.json", context.repositoryRoot));
    await write(context, ".gitignore", "keep\n");
    await assertRejects(() =>
      applyLocalChangePlan(context.repositoryRoot, plan)
    );
    assertEquals(await context.files.readText(".gitignore"), "keep\n");
  });
});

Deno.test("git-ignore reconciles projected config creation, JSON edits and removal", async () => {
  await repository(async (context) => {
    await apply(context, true);
    const initial: ChangePlan = {
      featureId: "related",
      action: "enable",
      summary: "Configure test",
      warnings: [],
      preconditions: [],
      validations: [],
      changes: [{
        kind: "write-file",
        path: "deno.jsonc",
        content:
          '{"tasks":{"test":"deno test --coverage=coverage"},"nodeModulesDir":"auto"}',
        expectedDigest: undefined,
      }],
    };
    let plans = await reconcileGitIgnorePlans(context, [initial]);
    assertEquals(plans.map((plan) => plan.featureId), [
      "git-ignore",
      "related",
    ]);
    for (const plan of plans) {
      await applyLocalChangePlan(context.repositoryRoot, plan);
    }
    assertStringIncludes(
      (await context.files.readText(".gitignore"))!,
      "/coverage/\n",
    );
    assertEquals((await gitIgnoreFeature.detect(context)).state, "enabled");
    const edit: ChangePlan = {
      ...initial,
      changes: [{
        kind: "remove-json",
        path: "deno.jsonc",
        jsonPath: ["tasks", "test"],
        expected: "deno test --coverage=coverage",
      }, {
        kind: "set-json",
        path: "deno.jsonc",
        jsonPath: ["nodeModulesDir"],
        value: "none",
        expected: "auto",
      }],
    };
    plans = await reconcileGitIgnorePlans(context, [edit]);
    for (const plan of plans) {
      await applyLocalChangePlan(context.repositoryRoot, plan);
    }
    const content = (await context.files.readText(".gitignore"))!;
    assert(!content.includes("/coverage/"));
    assert(!content.includes("/node_modules/"));
    assertEquals((await gitIgnoreFeature.detect(context)).state, "enabled");
    const remove: ChangePlan = {
      ...initial,
      changes: [{
        kind: "remove-file",
        path: "deno.jsonc",
        expectedDigest: (await context.files.digest("deno.jsonc"))!,
      }],
    };
    for (const plan of await reconcileGitIgnorePlans(context, [remove])) {
      await applyLocalChangePlan(context.repositoryRoot, plan);
    }
    assertEquals(await context.files.readText("deno.jsonc"), undefined);
    assertEquals(await reconcileGitIgnorePlans(context, []), []);
    const disable = await gitIgnoreFeature.checkDisable(context);
    assert(disable.result === "allowed");
    const disablePlan = await gitIgnoreFeature.planDisable(context, disable);
    const disabledPlans = await reconcileGitIgnorePlans(context, [
      disablePlan,
      initial,
    ]);
    assertEquals(disabledPlans.map((plan) => plan.featureId), [
      "git-ignore",
      "related",
    ]);
    for (const plan of disabledPlans) {
      await applyLocalChangePlan(context.repositoryRoot, plan);
    }
    assertEquals(await context.files.readText(".gitignore"), undefined);
    assertEquals(await reconcileGitIgnorePlans(context, [initial]), [initial]);
  });
});

Deno.test("git-ignore preserves unknown markers and a missing final newline", () => {
  assertEquals(
    gitIgnoreContent("# hj:git-ignore unknown\ncustom"),
    "# hj:git-ignore unknown\ncustom",
  );
  assertEquals(
    gitIgnoreContent("custom", [".*.swp"]),
    "custom\n# hj:git-ignore\n# hj:git-ignore .*.swp\n.*.swp\n",
  );
});

async function apply(context: OperationContext, enabled: boolean) {
  const check =
    await (enabled
      ? gitIgnoreFeature.checkEnable
      : gitIgnoreFeature.checkDisable)(context);
  assert(check.result === "allowed");
  await applyLocalChangePlan(
    context.repositoryRoot,
    await (enabled
      ? gitIgnoreFeature.planEnable
      : gitIgnoreFeature.planDisable)(context, check),
  );
}

function write(context: OperationContext, path: string, content: string) {
  return Deno.writeTextFile(new URL(path, context.repositoryRoot), content);
}

async function repository(
  action: (context: OperationContext) => Promise<void>,
) {
  const path = await Deno.makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-git-ignore-",
  });
  const root = new URL(`file://${path}/`);
  const unused = () => {
    throw new Error("git-ignore must not access Git");
  };
  try {
    await action({
      repositoryRoot: root,
      files: new LocalFileReader(root),
      git: {
        isRepository: unused,
        head: unused,
        status: unused,
        remotes: unused,
        defaultBranch: unused,
      },
      detections: new Map(),
      requestedChanges: [],
      resolvedChanges: [],
      repair: undefined,
      options: {},
    });
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}
