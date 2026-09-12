import { test as nativeTest } from "node:test";
import { testStep, trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import {
  makeTempDir,
  readTextFile,
  remove,
  writeTextFile,
} from "../testing/files-test-fixtures.ts";
import { runRawCommand as runCommand } from "../runtime/command.ts";
import { packageMetadataTask } from "./deno-cli-artifacts.ts";
import { assert, assertEquals, assertRejects } from "@std/assert";
import { parse } from "jsonc-parser";
import { parseFeatures } from "../cli/parse-features.ts";
import { runFeatureOperation } from "../cli/run-features.ts";
import { builtInFeatureRegistry } from "./built-in-feature-registry.ts";
import {
  coverageTaskDefinition,
  testWatchTaskDefinition,
} from "./deno-test-tasks.ts";
import { denoServerTasks } from "./deno-server-tasks.ts";
import { denoTaskDefinitions, leafTaskDefinitions } from "./deno-tasks.ts";

const taskIds = ["deno-lint", "deno-typecheck", "deno-test"] as const;

test("repairs formatting without replacing configured tasks or unrelated aggregates", async () => {
  await withRepository(async (root) => {
    await run(root, ...taskIds.map((id) => `--${id}`));
    let config = await readConfig(root);
    config.tasks.lint = { command: "deno lint --rules-exclude=no-window" };
    config.tasks.fmt = { command: "prettier --write ." };
    await writeConfig(root, config);

    const repaired = await run(root, "--repair");
    for (const id of ["deno-fmt", ...taskIds]) {
      assert(repaired.replace(/ +/g, " ").includes(`${id} enabled`), repaired);
    }
    config = await readConfig(root);
    assertEquals(config.tasks.fmt, denoTaskDefinitions().fmt);
    assertEquals(config.tasks.format, denoTaskDefinitions().format);
    assertEquals(config.tasks.lint, {
      command: "deno lint --rules-exclude=no-window",
    });
    assertEquals(config.tasks.typecheck, leafTaskDefinitions["deno-typecheck"]);
    assertEquals(config.tasks.test, leafTaskDefinitions["deno-test"]);
    assertEquals(config.tasks.check, denoTaskDefinitions(taskIds).check);

    config.tasks.check = { dependencies: ["custom"] };
    await writeConfig(root, config);
    await run(root, "--deno-lint");
    await run(root, "--repair", "--deno-lint");
    config = await readConfig(root);
    assertEquals(config.tasks.check, { dependencies: ["custom"] });
  });
});

test("preserves JSONC comments and custom tasks", async () => {
  await withRepository(async (root) => {
    const base = denoTaskDefinitions();
    const text = `// keep this comment\n${
      JSON.stringify(
        {
          tasks: { ...base, custom: { command: "deno eval 'custom'" } },
        },
        null,
        2,
      )
    }\n`;
    await writeTextFile(new URL("deno.jsonc", root), text);

    await run(root, ...taskIds.map((id) => `--${id}`));
    await run(root, "--no-deno-lint", "--no-deno-test");

    const result = await readTextFile(new URL("deno.jsonc", root));
    const config = parse(result) as { tasks: Record<string, unknown> };
    assert(result.replace(/ +/g, " ").includes("// keep this comment"));
    assertEquals(config.tasks.custom, { command: "deno eval 'custom'" });
    assertEquals(
      config.tasks.check,
      denoTaskDefinitions(["deno-typecheck"]).check,
    );
    assertEquals(config.tasks.typecheck, leafTaskDefinitions["deno-typecheck"]);
  });
});

test("composes task and code features initially", async () => {
  await withRepository(async (root) => {
    await run(
      root,
      "--deno-lint",
      "--deno-typecheck",
      "--deno-test",
      "--deno-cli",
      "--deno-lib",
      "--deno-server",
    );

    const config = await readConfig(root);
    assertEquals(config.exports, {
      ".": "./src/lib/mod.ts",
      "./cli": "./src/cli/cli.ts",
      "./server": "./src/server/server.ts",
    });
    assertEquals(config.tasks, {
      ...denoTaskDefinitions(taskIds),
      "package-metadata": packageMetadataTask,
      ...denoServerTasks,
      coverage: coverageTaskDefinition,
      "dev:test": testWatchTaskDefinition,
      lint: leafTaskDefinitions["deno-lint"],
      typecheck: leafTaskDefinitions["deno-typecheck"],
      test: leafTaskDefinitions["deno-test"],
    });
    await command(root, [
      "test",
      "test/cli_test.ts",
      "test/lib_test.ts",
      "test/server_test.ts",
    ]);
  });
});

test("classifies task conflicts", async (t) => {
  const cases = [{
    name: "missing tasks are disabled and enable is allowed",
    config: {},
    expected: "deno-lint disabled",
    enabled: true,
  }, {
    name: "non-object tasks are ambiguous and blocked",
    config: { tasks: [] },
    expected: "deno-lint ambiguous",
    enabled: false,
  }, {
    name: "invalid leaf is ambiguous and blocked",
    config: { tasks: { ...denoTaskDefinitions(), lint: 7 } },
    expected: "deno-lint ambiguous",
    enabled: false,
  }, {
    name: "differing object leaf is drifted and blocked without repair",
    config: {
      tasks: { ...denoTaskDefinitions(), lint: { command: "eslint" } },
    },
    expected: "deno-lint drifted",
    enabled: false,
  }];
  for (const item of cases) {
    await testStep(t, item.name, async () => {
      await withRepository(async (root) => {
        await writeConfig(root, item.config);
        const status = await run(root);
        assert(status.replace(/ +/g, " ").includes(item.expected), status);
        if (item.enabled) {
          const result = await run(root, "--deno-lint");
          assert(
            result.replace(/ +/g, " ").includes("deno-lint enabled"),
            result,
          );
        } else {
          await assertRejects(() => run(root, "--deno-lint"), Error);
        }
      });
    });
  }
});

test("lint task fixes locally and only checks in CI", async () => {
  await withRepository(async (root) => {
    await run(root, "--deno-lint");
    const target = new URL("lint_target.ts", root);
    await writeTextFile(target, 'window.console.log("x");\n');
    await command(root, ["lint", "--fix", "lint_target.ts"]);
    assertEquals(
      await readTextFile(target),
      'globalThis.console.log("x");\n',
    );

    await writeTextFile(target, 'window.console.log("x");\n');
    const ci = await command(root, ["task", "lint"], { CI: "1" }, false);
    assert(!ci.success, ci.stderr);
    assertEquals(await readTextFile(target), 'window.console.log("x");\n');

    const local = await command(root, ["task", "lint"], { CI: "" }, false);
    assert(local.success, local.stderr);
    assertEquals(
      await readTextFile(target),
      'globalThis.console.log("x");\n',
    );
  });
});

async function withRepository(
  action: (root: URL) => Promise<void>,
): Promise<void> {
  const path = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-tasks-",
  });
  try {
    await action(new URL(`file://${path}/`));
  } finally {
    await remove(path, { recursive: true });
  }
}

function run(root: URL, ...flags: string[]): Promise<string> {
  return runFeatures(
    root,
    parseFeatures(["repo", "features", ...flags], builtInFeatureRegistry),
  );
}

async function readConfig(root: URL): Promise<TaskConfig> {
  return JSON.parse(
    await readTextFile(new URL("deno.jsonc", root)),
  ) as TaskConfig;
}

function writeConfig(root: URL, config: unknown): Promise<void> {
  return writeTextFile(
    new URL("deno.jsonc", root),
    `${JSON.stringify(config, null, 2)}\n`,
  );
}

async function command(
  root: URL,
  args: string[],
  env: Record<string, string> = {},
  requireSuccess = true,
): Promise<{ readonly success: boolean; readonly stderr: string }> {
  const result = await runCommand("deno", {
    args,
    cwd: root.pathname,
    env,
  });
  const output = {
    success: result.success,
    stderr: new TextDecoder().decode(result.stderr),
  };
  assert(!requireSuccess || output.success, output.stderr);
  return output;
}

type TaskConfig = {
  readonly exports?: unknown;
  readonly tasks: Record<string, Record<string, unknown>>;
};

// These fixtures inspect generated features and execute their tasks separately.
function runFeatures(
  root: URL,
  args: Parameters<typeof runFeatureOperation>[1],
) {
  return runFeatureOperation(root, args, builtInFeatureRegistry, undefined, {
    runFinalTask: () => Promise.resolve(undefined),
  });
}
