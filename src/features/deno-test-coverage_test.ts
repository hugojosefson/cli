import { test as nativeTest } from "node:test";
import { testStep, trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import {
  chmod,
  makeTempDir,
  mkdir,
  readTextFile,
  remove,
  writeTextFile,
} from "../testing/files-test-fixtures.ts";
import { runRawCommand as runCommand } from "../runtime/command.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import type { OperationContext } from "../api/repository-context.ts";
import { LocalFileReader } from "../repository/local-file-reader.ts";
import { LocalGitReader } from "../repository/local-git-reader.ts";
import { applyLocalChangePlan } from "../operations/local-change-plan.ts";
import { denoTaskFeature } from "./deno-task-feature.ts";
import type { JsonValue } from "../api/json.ts";
import { parseFeatures } from "../cli/parse-features.ts";
import { runFeatureOperation } from "../cli/run-features.ts";
import { builtInFeatureRegistry } from "./built-in-feature-registry.ts";
import { denoServerTasks } from "./deno-server-tasks.ts";
import {
  coverageTaskDefinition,
  testWatchTaskDefinition,
} from "./deno-test-tasks.ts";
import { denoTaskDefinitions, leafTaskDefinitions } from "./deno-tasks.ts";

test("test coverage tasks follow test and server feature transitions", async (t) => {
  for (const first of ["tests", "server", "together"]) {
    await testStep(t, first, () =>
      withRepository(async (root) => {
        if (first === "tests") {
          await run(root, "--deno-test");
          assertEquals(
            (await readConfig(root)).tasks.dev,
            testWatchTaskDefinition,
          );
          await run(root, "--deno-server");
        } else if (first === "server") {
          await run(root, "--deno-server");
          await run(root, "--deno-test", "--deno-server");
        } else await run(root, "--deno-test", "--deno-server");
        let config = await readConfig(root);
        assertEquals(config.tasks.coverage, coverageTaskDefinition);
        assertEquals(config.tasks.dev, denoServerTasks.dev);
        assertEquals(config.tasks["dev:test"], testWatchTaskDefinition);
        await run(root, "--no-deno-server");
        config = await readConfig(root);
        assertEquals(config.tasks.dev, testWatchTaskDefinition);
        assertEquals(config.tasks["dev:test"], undefined);
        await run(root, "--deno-server");
        await run(root, "--no-deno-test");
        config = await readConfig(root);
        assertEquals(config.tasks.dev, denoServerTasks.dev);
        assertEquals(config.tasks.coverage, undefined);
        assertEquals(config.tasks["dev:test"], undefined);
        await run(root, "--deno-test");
        await run(root, "--no-deno-server", "--no-deno-test", "--no-deno-fmt");
        config = await readConfig(root);
        assertEquals(config.tasks, {});
      }));
  }
});

test("test tasks compose with absent server removal and existing exports", async () => {
  await withRepository(async (root) => {
    await run(root, "--deno-test", "--no-deno-server");
    assertEquals((await readConfig(root)).tasks.dev, testWatchTaskDefinition);
    await run(root, "--no-deno-test", "--no-deno-server");
    assertEquals((await readConfig(root)).tasks.coverage, undefined);
    assertEquals((await readConfig(root)).tasks.dev, undefined);
    await writeConfig(root, {
      exports: { "./server": "./src/server/server.ts" },
    });
    await run(root, "--deno-test");
    assertEquals(
      (await readConfig(root)).tasks["dev:test"],
      testWatchTaskDefinition,
    );
  });
});

test("server transitions preserve custom test tasks and reject watch collisions", async () => {
  await withRepository(async (root) => {
    await run(root, "--deno-test");
    let config = await readConfig(root);
    config.tasks["dev:test"] = "custom watcher";
    await writeConfig(root, config);
    await assertRejects(() => run(root, "--deno-server"), Error, "dev:test");
    assertEquals((await readConfig(root)).tasks.dev, testWatchTaskDefinition);
    delete config.tasks["dev:test"];
    await writeConfig(root, config);
    await run(root, "--deno-server");
    config = await readConfig(root);
    config.tasks.coverage = "custom coverage";
    await writeConfig(root, config);
    await assertRejects(() => run(root, "--no-deno-server"), Error, "coverage");
    config.tasks.test = "deno test test/";
    await writeConfig(root, config);
    await run(root, "--no-deno-server");
    await run(root, "--deno-server");
    await run(root, "--deno-test");
    assertEquals((await readConfig(root)).tasks.coverage, "custom coverage");
    assertEquals((await readConfig(root)).tasks.test, "deno test test/");
  });
});

test("test tasks preserve custom development tasks and guard alias collisions", async () => {
  await withRepository(async (root) => {
    const custom = { command: "deno run app.ts" };
    await writeConfig(root, {
      tasks: { ...denoTaskDefinitions(), dev: custom },
    });
    await run(root, "--deno-test");
    let config = await readConfig(root);
    assertEquals(config.tasks.dev, custom);
    assertEquals(config.tasks["dev:test"], testWatchTaskDefinition);
    await run(root, "--no-deno-test");
    config = await readConfig(root);
    assertEquals(config.tasks.dev, custom);
    assertEquals(config.tasks["dev:test"], undefined);
    for (const name of ["coverage", "dev:test"]) {
      config.tasks[name] = custom;
      await writeConfig(root, config);
      await assertRejects(() => run(root, "--deno-test"), Error, name);
      assertEquals((await readConfig(root)).tasks[name], custom);
      await run(root, "--deno-test", "--repair");
      assertEquals((await readConfig(root)).tasks.dev, custom);
      await run(root, "--no-deno-test");
      config = await readConfig(root);
    }
  });
});

test("missing coverage and watch aliases drift and repair independently", async () => {
  await withRepository(async (root) => {
    await run(root, "--deno-test");
    const config = await readConfig(root);
    delete config.tasks.coverage;
    delete config.tasks.dev;
    await writeConfig(root, config);
    assertStringIncludes(
      (await run(root)).replace(/ +/g, " "),
      "deno-test drifted",
    );
    await run(root, "--deno-test");
    assertEquals(
      (await readConfig(root)).tasks.coverage,
      coverageTaskDefinition,
    );
    assertEquals((await readConfig(root)).tasks.dev, testWatchTaskDefinition);
    config.tasks.test = {
      description: "Run tests.",
      command: "deno test --parallel --trace-leaks",
    };
    await writeConfig(root, config);
    await run(root, "--deno-test", "--repair");
    assertEquals(
      (await readConfig(root)).tasks.test,
      leafTaskDefinitions["deno-test"],
    );
  });
});

test("coverage repair rejects changes made after the plan", async () => {
  await withRepository(async (root) => {
    await run(root, "--deno-test");
    const config = await readConfig(root);
    delete config.tasks.coverage;
    await writeConfig(root, config);
    const context: OperationContext = {
      repositoryRoot: root,
      files: new LocalFileReader(root),
      git: new LocalGitReader(root),
      detections: new Map(),
      requestedChanges: [],
      resolvedChanges: [{
        featureId: "deno-test",
        enabled: true,
        reason: { kind: "explicit-request" },
      }],
      repair: undefined,
      options: {},
    };
    const feature = denoTaskFeature("deno-test", "Deno tests");
    const check = await feature.checkEnable(context);
    assert(check.result === "allowed");
    const plan = await feature.planEnable(context, check);
    config.tasks.coverage = "custom coverage";
    await writeConfig(root, config);
    await assertRejects(() => applyLocalChangePlan(root, plan));
    assertEquals((await readConfig(root)).tasks.coverage, "custom coverage");
  });
});

test("default and CI aggregates collect tests once through the ordinary task", async () => {
  await withRepository(async (root) => {
    await run(root, "--deno-test");
    await writeTextFile(
      new URL("source.ts", root),
      "export const value = 1;\n",
    );
    await writeTextFile(
      new URL("source_test.ts", root),
      'import { value } from "./source.ts"; Deno.test("runs", () => { console.log("TEST_RUN_MARKER"); if (value !== 1) throw Error(); });\n',
    );
    for (const task of ["default", "all"]) {
      const result = await command(root, ["task", task]);
      assertEquals(result.code, 0, result.output);
      assertEquals(
        result.output.match(/TEST_RUN_MARKER/g)?.length,
        1,
        result.output,
      );
      assertStringIncludes(result.output, "source.ts");
    }
  });
});

test("generated formatting ignores coverage reports without changing their contents", async () => {
  await withRepository(async (root) => {
    await run(root, "--deno-test");
    await mkdir(new URL("coverage/html", root), { recursive: true });
    const path = new URL("coverage/html/index.html", root);
    const content = "<html><body><h1>Generated coverage</h1></body></html>";
    await writeTextFile(path, content);
    for (const task of ["fmt", "format"]) {
      const result = await command(root, ["task", task]);
      assertEquals(result.code, 0, result.output);
      assertEquals(await readTextFile(path), content);
    }
  });
});

test("ordinary and alias test runs report only fresh coverage after success and failure", async () => {
  await withRepository(async (root) => {
    await run(root, "--deno-test");
    await writeTextFile(
      new URL("old.ts", root),
      "export const old = 1;\n",
    );
    await writeTextFile(
      new URL("old_test.ts", root),
      'import { old } from "./old.ts"; Deno.test("old", () => { if (old !== 1) throw Error(); });\n',
    );
    let result = await command(root, ["task", "test", "old_test.ts"]);
    assertEquals(result.code, 0, result.output);
    assertStringIncludes(result.output, "old.ts");
    await remove(new URL("old.ts", root));
    await remove(new URL("old_test.ts", root));
    await writeTextFile(
      new URL("current.ts", root),
      "export const current = 2;\n",
    );
    await writeTextFile(
      new URL("current_test.ts", root),
      'import { current } from "./current.ts"; Deno.test("name with spaces", () => { if (current === 2) throw Error("expected failure"); });\n',
    );
    result = await command(root, [
      "task",
      "coverage",
      "--filter",
      "name with spaces",
    ]);
    assertEquals(result.code, 1, result.output);
    assertStringIncludes(result.output, "expected failure");
    assertStringIncludes(result.output, "current.ts");
    assert(!result.output.includes("old.ts"), result.output);
    const report = await command(root, ["coverage", "coverage"]);
    assertEquals(report.code, 0, report.output);
    assertStringIncludes(report.output, "current.ts");
    assert(!report.output.includes("old.ts"), report.output);
  });
});

test("test runner preserves test exit codes and reports report failures", async () => {
  await withRepository(async (root) => {
    await mkdir(new URL("bin", root));
    const fakeDeno = new URL("bin/deno", root);
    await writeTextFile(
      fakeDeno,
      '#!/bin/sh\nif test "$1" = test; then exit "$TEST_STATUS"; fi\nprintf "REPORT ATTEMPTED\\n"\nexit "$REPORT_STATUS"\n',
    );
    await chmod(fakeDeno, 0o755);
    for (
      const [testStatus, reportStatus, expected] of [[0, 0, 0], [7, 0, 7], [
        7,
        9,
        7,
      ], [0, 9, 9]]
    ) {
      const result = await runCommand("sh", {
        args: ["-c", leafTaskDefinitions["deno-test"].command as string],
        cwd: root,
        env: {
          PATH: `${root.pathname}bin:/usr/bin:/bin`,
          TEST_STATUS: String(testStatus),
          REPORT_STATUS: String(reportStatus),
        },
      });
      assertEquals(result.code, expected);
      assertStringIncludes(
        new TextDecoder().decode(result.stdout),
        "REPORT ATTEMPTED",
      );
    }
  });
});

async function withRepository(
  action: (root: URL) => Promise<void>,
): Promise<void> {
  const path = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-test-coverage-",
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
function writeConfig(root: URL, config: unknown): Promise<void> {
  return writeTextFile(
    new URL("deno.jsonc", root),
    `${JSON.stringify(config, null, 2)}\n`,
  );
}
async function readConfig(
  root: URL,
): Promise<{ tasks: Record<string, JsonValue> }> {
  return JSON.parse(await readTextFile(new URL("deno.jsonc", root)));
}
async function command(root: URL, args: string[]) {
  const result = await runCommand("deno", { args, cwd: root });
  return {
    code: result.code,
    output: new TextDecoder().decode(result.stdout) +
      new TextDecoder().decode(result.stderr),
  };
}

// These fixtures inspect generated features and execute their tasks separately.
function runFeatures(
  root: URL,
  args: Parameters<typeof runFeatureOperation>[1],
) {
  return runFeatureOperation(root, args, builtInFeatureRegistry, undefined, {
    runFinalTask: () => Promise.resolve(undefined),
  });
}
