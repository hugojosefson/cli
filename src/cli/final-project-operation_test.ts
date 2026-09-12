import { runCliProcess } from "../testing/runtime-test-fixtures.ts";
import { assertMissingFile } from "../testing/files-test-fixtures.ts";
import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import {
  fixtureStat,
  makeTempDir,
  readTextFile,
  remove,
  writeTextFile,
} from "../testing/files-test-fixtures.ts";
import { runCommand } from "../runtime/command.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { denoFmtFeature } from "../features/deno-fmt-feature.ts";
import { builtInFeatureRegistry } from "../features/built-in-feature-registry.ts";
import { denoTaskDefinitions } from "../features/deno-tasks.ts";
import { readmeStaticFeature } from "../features/readme-static-feature.ts";
import type { FeatureRegistry } from "../features/feature-registry.ts";
import { CommandFailure } from "./command-failure.ts";
import { parseFeatures } from "./parse-features.ts";
import { runFeatureOperation } from "./run-features.ts";

const registry: FeatureRegistry = {
  features: [readmeStaticFeature],
  capabilities: [{
    id: "readme",
    providerPolicy: "exclusive",
    defaultProvider: "readme-static",
  }],
};

test("initial library checks pass before separate configuration contributions are committed", async () => {
  await fixture(async (root) => {
    const result = await runFeatureOperation(
      root,
      parseFeatures([
        "repo",
        "features",
        "--deno-lib",
        "--deno-lint",
        "--deno-typecheck",
        "--deno-test",
      ], builtInFeatureRegistry),
      builtInFeatureRegistry,
    );
    assertStringIncludes(result, "deno task default passed.");
    const history = (await git(root, "log", "--reverse", "--format=%H %s"))
      .split("\n");
    for (
      const [feature, task] of [["deno-lint", "lint"], [
        "deno-typecheck",
        "typecheck",
      ], ["deno-test", "test"]]
    ) {
      const commit = history.find((line) =>
        line.includes(`chore(${feature}):`)
      )!.split(" ")[0];
      const before = JSON.parse(
        await git(root, "show", `${commit}^:deno.jsonc`),
      );
      const after = JSON.parse(await git(root, "show", `${commit}:deno.jsonc`));
      assertEquals(before.tasks[task], undefined);
      assert(after.tasks[task]);
      assert(after.tasks.check.dependencies.includes(task));
    }
    const fmt = history.find((line) =>
      line.includes("chore(deno-fmt):")
    )!.split(" ")[0];
    assertEquals(
      JSON.parse(await git(root, "show", `${fmt}:deno.jsonc`)).exports,
      undefined,
    );
    const lib =
      history.find((line) => line.includes("chore(deno-lib):"))!.split(" ")[0];
    assertEquals(
      JSON.parse(await git(root, "show", `${lib}:deno.jsonc`)).exports["."],
      "./src/lib/mod.ts",
    );
    assertEquals(
      JSON.parse(await git(root, "show", `${fmt}:deno.jsonc`)).imports,
      undefined,
    );
    assertEquals(
      JSON.parse(await git(root, "show", `${lib}:deno.jsonc`))
        .imports["@std/assert"],
      "jsr:@std/assert@^1.0.19",
    );
    assertEquals(
      JSON.parse(await readTextFile(new URL("deno.jsonc", root))).lock,
      false,
    );
    assertEquals(await git(root, "diff", "HEAD", "--"), "");
    assert(
      !(await git(root, "ls-tree", "-r", "--name-only", "HEAD")).includes(
        "coverage/",
      ),
    );
  });
});

test("library assertion imports enter an application lock before frozen checks", async () => {
  await fixture(async (root) => {
    const result = await runFeatureOperation(
      root,
      parseFeatures([
        "repo",
        "features",
        "--deno-lib",
        "--deno-server",
        "--deno-typecheck",
        "--deno-test",
      ], builtInFeatureRegistry),
      builtInFeatureRegistry,
    );
    assertStringIncludes(result, "deno task default passed.");
    const config = JSON.parse(
      await readTextFile(new URL("deno.jsonc", root)),
    );
    assertEquals(config.lock, true);
    const lock = JSON.parse(
      await readTextFile(new URL("deno.lock", root)),
    );
    assert(lock.specifiers["jsr:@std/assert@^1.0.19"]);
    assertEquals(await git(root, "diff", "HEAD", "--"), "");
    const check = await runCommand("deno", {
      args: ["test", "--frozen", "test/lib_test.ts"],
      cwd: root,
    });
    assert(check.success, new TextDecoder().decode(check.stderr));
  });
});

test("server setup creates its owned lock before a frozen final check and commits its digest", async () => {
  await fixture(async (root) => {
    await writeTextFile(
      new URL("deno.json", root),
      JSON.stringify({
        tasks: {
          ...denoTaskDefinitions(["deno-typecheck"]),
          typecheck: { command: "deno check --frozen src/server/server.ts" },
        },
      }),
    );
    await git(root, "add", "deno.json");
    await git(root, "commit", "-m", "chore: seed");
    const result = await runFeatureOperation(
      root,
      parseFeatures(
        ["repo", "features", "--deno-server"],
        builtInFeatureRegistry,
      ),
      builtInFeatureRegistry,
    );
    assertStringIncludes(result, "deno task default passed.");
    const ownership = JSON.parse(
      await git(root, "show", "HEAD:.hj/deno-lock.json"),
    );
    assertEquals(ownership.lock, true);
    assert(ownership.digest);
    assertEquals(
      await git(root, "show", "HEAD:deno.lock"),
      (await readTextFile(new URL("deno.lock", root))).trim(),
    );
    assertEquals(await git(root, "status", "--porcelain"), "");
  });
});

test("operation runs final task before content commits and commits the validated task output", async () => {
  await fixture(async (root) => {
    await seed(
      root,
      `
      const head = await new Deno.Command("git", {args:["rev-list", "--count", "HEAD"]}).output();
      if (new TextDecoder().decode(head.stdout).trim() !== "1") Deno.exit(7);
      if (Deno.readTextFileSync("README.md").includes("Corrected")) Deno.exit(8);
      Deno.writeTextFileSync("README.md", "# Corrected\\n");
    `,
    );
    const result = await run(root, "--readme-static");
    assertStringIncludes(result, "deno task default passed.");
    assertEquals(await git(root, "rev-list", "--count", "HEAD"), "2");
    assertEquals(await git(root, "show", "HEAD:README.md"), "# Corrected");
    assertEquals(await git(root, "status", "--porcelain"), "");
    assertStringIncludes(await run(root, "--readme-static"), "No changes.");
    assertEquals(await git(root, "rev-list", "--count", "HEAD"), "2");
  });
});

test("operation returns task failure without content commits and preserves task edits", async () => {
  await fixture(async (root) => {
    await seed(
      root,
      `Deno.writeTextFileSync("README.md", "# Fix this\\n"); Deno.exit(17);`,
    );
    const before = await git(root, "rev-parse", "HEAD");
    const error = await assertRejects(
      () => run(root, "--readme-static"),
      CommandFailure,
    );
    assertEquals(error.exitCode, 17);
    assertEquals(await git(root, "rev-parse", "HEAD"), before);
    assertEquals(
      await readTextFile(new URL("README.md", root)),
      "# Fix this\n",
    );
    assertEquals(await git(root, "status", "--porcelain"), "?? README.md");
  });
});

test("unattributed task edits remain visible and prevent content commits", async () => {
  await fixture(async (root) => {
    await seed(
      root,
      `Deno.writeTextFileSync("unrelated.txt", "unexpected\\n");`,
    );
    const before = await git(root, "rev-parse", "HEAD");
    await assertRejects(() => run(root, "--readme-static"));
    assertEquals(await git(root, "rev-parse", "HEAD"), before);
    assertEquals(
      await readTextFile(new URL("unrelated.txt", root)),
      "unexpected\n",
    );
    assertStringIncludes(
      await git(root, "status", "--porcelain"),
      "?? README.md",
    );
  });
});

test("CLI exits with the final task's original failure code", async () => {
  await fixture(async (root) => {
    await seed(root, "Deno.exit(17);");
    const result = await runCliProcess([
      "repo",
      "features",
      "--readme-static",
    ], { cwd: root });
    assertEquals(result.code, 17, new TextDecoder().decode(result.stderr));
    assertStringIncludes(
      new TextDecoder().decode(result.stderr),
      "deno task default failed (exit 17)",
    );
    assertEquals(await git(root, "rev-list", "--count", "HEAD"), "1");
  });
});

test("removing the feature that supplied default reports its absence", async () => {
  await fixture(async (root) => {
    const fmtRegistry = { features: [denoFmtFeature], capabilities: [] };
    const operation = (flag: string) =>
      runFeatureOperation(
        root,
        parseFeatures(["repo", "features", flag], fmtRegistry),
        fmtRegistry,
      );
    assertStringIncludes(
      await operation("--deno-fmt"),
      "deno task default passed.",
    );
    const result = await operation("--no-deno-fmt");
    assertStringIncludes(result, "No final default task remains.");
    await assertMissingFile(() => fixtureStat(new URL("deno.jsonc", root)));
    assertEquals(await git(root, "status", "--porcelain"), "");
  });
});

test("status inspection never starts an existing failing default task", async () => {
  await fixture(async (root) => {
    await seed(root, "Deno.exit(17);");
    assertStringIncludes(await run(root), "readme-static");
    assertEquals(await git(root, "rev-list", "--count", "HEAD"), "1");
  });
});

async function run(root: URL, ...flags: string[]) {
  return await runFeatureOperation(
    root,
    parseFeatures(["repo", "features", ...flags], registry),
    registry,
  );
}

async function seed(root: URL, code: string) {
  await writeTextFile(new URL("task.ts", root), code);
  await writeTextFile(
    new URL("deno.json", root),
    JSON.stringify({
      tasks: {
        default: "deno run --allow-read --allow-write --allow-run=git task.ts",
      },
    }),
  );
  await git(root, "add", ".");
  await git(root, "commit", "-m", "chore: seed");
}

async function fixture(action: (root: URL) => Promise<void>) {
  const path = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-final-operation-",
  });
  const root = new URL(`file://${path}/`);
  try {
    await git(root, "init", "--initial-branch=main");
    await git(root, "config", "user.name", "Test User");
    await git(root, "config", "user.email", "test@example.invalid");
    await action(root);
  } finally {
    await remove(root, { recursive: true });
  }
}

async function git(root: URL, ...args: string[]) {
  const result = await runCommand("git", { args, cwd: root });
  assert(result.success, new TextDecoder().decode(result.stderr));
  return new TextDecoder().decode(result.stdout).trim();
}
