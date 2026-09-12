import { externalDeno } from "../testing/runtime-test-fixtures.ts";
import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import {
  chmod,
  fixtureReadDir,
  fixtureStat,
  makeTempDir,
  mkdir,
  readTextFile,
  remove,
  writeTextFile,
} from "../testing/files-test-fixtures.ts";
import { runRawCommand as runCommand } from "../runtime/command.ts";
import { fileAccess } from "../repository/file-access.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { runCli as executeCli } from "../cli/run-cli.ts";
import { runFeatureOperation } from "../cli/run-features.ts";
import { parseFeatures } from "../cli/parse-features.ts";
import { builtInFeatureRegistry } from "../features/built-in-feature-registry.ts";
import { LocalFileReader } from "../repository/local-file-reader.ts";
import {
  denoTaskDefinitions,
  isReadmeTask,
  readmeTaskDefinition,
} from "./deno-tasks.ts";
import { hjPackageReference } from "./hj-package.ts";

test("readme-build retains an exact older CLI pin across releases", async () => {
  const oldTask = {
    ...readmeTaskDefinition,
    command: (readmeTaskDefinition.command as string).replace(
      hjPackageReference,
      "jsr:@hugojosefson/cli@0.1.0",
    ),
  };
  assert(isReadmeTask(oldTask));
  for (
    const command of [
      oldTask.command.replace("@0.1.0", "@^0.1.0"),
      oldTask.command.replace("@0.1.0", "@latest"),
      oldTask.command.replace("@hugojosefson/cli", "@other/cli"),
      oldTask.command.replace("chmod 444", "chmod 644"),
      `${oldTask.command} && echo changed`,
    ]
  ) assert(!isReadmeTask({ ...oldTask, command }));
  assert(!isReadmeTask(undefined));
  assert(!isReadmeTask("deno task readme"));
  assert(!isReadmeTask({ command: 42 }));
  assert(!isReadmeTask({ ...oldTask, description: "custom" }));

  await withRepository(async (root) => {
    await runCli(root, ["repo", "features", "--readme-build"]);
    const config = JSON.parse(await read(root, "deno.jsonc"));
    config.tasks.readme = oldTask;
    await write(root, "deno.jsonc", JSON.stringify(config));
    const status = (await runCli(root, ["repo", "features"])).output;
    assertStringIncludes(status.replace(/ +/g, " "), "readme-build enabled");
    const repeat = await runCli(root, ["repo", "features", "--readme-build"]);
    assertStringIncludes(repeat.output, "No changes.");
    assertEquals(
      JSON.parse(await read(root, "deno.jsonc")).tasks.readme,
      oldTask,
    );
    await runCli(root, ["repo", "features", "--no-readme-build", "--yes"]);
    assertEquals(
      JSON.parse(await read(root, "deno.jsonc")).tasks.readme,
      undefined,
    );
  });
});

test("readme-build converts static content and reverses it", async () => {
  await withRepository(async (root) => {
    await write(root, "README.md", "# Kept\n");
    await runCli(root, ["repo", "features", "--readme-build"]);
    const files = new LocalFileReader(root);
    assertStringIncludes(await read(root, "readme/README.md"), "# Kept\n");
    assertStringIncludes(await read(root, "README.md"), "# Kept\n");
    const observed = await files.observe("README.md");
    assert(observed.kind === "file");
    assertEquals(fileAccess(observed).writable, false);
    const config = JSON.parse(await read(root, "deno.jsonc"));
    assertEquals(config.tasks.readme, readmeTaskDefinition);
    assertEquals(config.tasks.default, denoTaskDefinitions([], true).default);

    await assertRejects(
      () => runCli(root, ["repo", "features", "--no-readme-build"]),
      Error,
      "confirmation required",
    );
    assertEquals(await files.exists("readme"), true);
    await runCli(root, [
      "repo",
      "features",
      "--no-readme-build",
      "--yes",
    ]);
    assertStringIncludes(await read(root, "README.md"), "# Kept\n");
    const restored = await files.observe("README.md");
    assert(restored.kind === "file");
    assertEquals(fileAccess(restored).writable, true);
    assertEquals(await files.exists("readme"), false);
  });
});

test("readme-build composes existing config and simultaneous removal", async () => {
  await withRepository(async (root) => {
    await write(root, "README.md", "# Existing config\n");
    await write(
      root,
      "deno.jsonc",
      `{
  // retained
  "custom": true
}
`,
    );
    await runCli(root, ["repo", "features", "--readme-build"]);
    assertStringIncludes(await read(root, "deno.jsonc"), "// retained");
    assertStringIncludes(await read(root, "deno.jsonc"), '"custom": true');
    await runCli(root, [
      "repo",
      "features",
      "--no-readme-build",
      "--no-deno-fmt",
      "--yes",
    ]);
    const status = (await runCli(root, ["repo", "features"])).output;
    assertStringIncludes(status.replace(/ +/g, " "), "deno-fmt disabled");
    assertStringIncludes(status.replace(/ +/g, " "), "readme-build disabled");
    assertEquals(await read(root, "README.md"), "# Existing config\n");
  });
});

test("readme-build extends an enabled deno.json without stale edits", async () => {
  await withRepository(async (root) => {
    await write(root, "README.md", "# deno.json\n");
    await write(
      root,
      "deno.json",
      `${
        JSON.stringify(
          {
            custom: true,
            tasks: denoTaskDefinitions(),
          },
          null,
          2,
        )
      }\n`,
    );
    await runCli(root, ["repo", "features", "--readme-build"]);
    const config = JSON.parse(await read(root, "deno.json"));
    assertEquals(config.custom, true);
    assertEquals(config.tasks.readme, readmeTaskDefinition);
    assertEquals(config.tasks.default, denoTaskDefinitions([], true).default);
    assertEquals(await new LocalFileReader(root).exists("deno.jsonc"), false);
  });
});

test("readme-build repairs task, aggregate, output, and mode drift", async () => {
  await withRepository(async (root) => {
    await write(root, "README.md", "# Source\n");
    await runCli(root, ["repo", "features", "--readme-build"]);
    await chmod(new URL("README.md", root), 0o644);
    await write(root, "README.md", "# Drift\n");
    await chmod(new URL("README.md", root), 0o444);
    const config = JSON.parse(await read(root, "deno.jsonc"));
    config.tasks.readme = { command: "false" };
    config.tasks.default = { command: "false" };
    await write(root, "deno.jsonc", `${JSON.stringify(config, null, 2)}\n`);

    await runCli(root, [
      "repo",
      "features",
      "--readme-build",
      "--repair",
    ]);
    assertStringIncludes(await read(root, "README.md"), "# Source\n");
    const observed = await new LocalFileReader(root).observe("README.md");
    assert(observed.kind === "file");
    assertEquals(fileAccess(observed).writable, false);
    const repaired = JSON.parse(await read(root, "deno.jsonc"));
    assertEquals(repaired.tasks.readme, readmeTaskDefinition);
    assertEquals(repaired.tasks.default, denoTaskDefinitions([], true).default);
  });
});

test("readme-build rejects ambiguous source paths without traversing them", async () => {
  await withRepository(async (root) => {
    const target = new URL("other", root);
    await mkdir(target);
    await symlink(target, new URL("readme", root));
    const status = (await runCli(root, ["repo", "features"])).output;
    assertStringIncludes(status.replace(/ +/g, " "), "readme-build ambiguous");
    await assertRejects(
      () => runCli(root, ["repo", "features", "--readme-build"]),
      Error,
      "ambiguous-feature",
    );
  });
});

test("readme-build rejects unsafe output and config without mutation", async () => {
  await withRepository(async (root) => {
    await write(root, "README.md", "# Invalid config\n");
    await write(root, "deno.json", "not json\n");
    await assertRejects(
      () => runCli(root, ["repo", "features", "--readme-build"]),
      Error,
      "ambiguous-feature",
    );
    assertEquals(await new LocalFileReader(root).exists("readme"), false);
    assertEquals(await read(root, "README.md"), "# Invalid config\n");
  });

  await withRepository(async (root) => {
    await write(root, "README.md", "# Unsafe output\n");
    await runCli(root, ["repo", "features", "--readme-build"]);
    await chmod(new URL("README.md", root), 0o755);
    await remove(new URL("README.md", root));
    await mkdir(new URL("README.md", root));
    await assertRejects(
      () =>
        runCli(root, [
          "repo",
          "features",
          "--readme-build",
          "--repair",
        ]),
      Error,
      "ambiguous-feature",
    );
    assertEquals(
      (await fixtureStat(new URL("README.md", root))).isDirectory,
      true,
    );
  });
});

test("readme-build preserves a conflicting default task", async () => {
  await withRepository(async (root) => {
    await write(root, "README.md", "# Custom default\n");
    const tasks = denoTaskDefinitions();
    await write(
      root,
      "deno.json",
      `${
        JSON.stringify(
          {
            tasks: { ...tasks, default: { command: "custom" } },
          },
          null,
          2,
        )
      }\n`,
    );
    await assertRejects(
      () => runCli(root, ["repo", "features", "--readme-build"]),
      Error,
      "default Deno task conflicts",
    );
    const config = JSON.parse(await read(root, "deno.json"));
    assertEquals(config.tasks.default, { command: "custom" });
    assertEquals(await new LocalFileReader(root).exists("readme"), false);
  });
});

test("readme task preserves failures and atomically replaces successes", async () => {
  await withRepository(async (root) => {
    await write(root, "README.md", "# Preserved\n");
    await runCli(root, ["repo", "features", "--readme-build"]);
    await git(root, "init");
    await git(root, "add", "README.md");
    await git(root, "ls-files", "--error-unmatch", "README.md");
    await mkdir(new URL("bin", root));
    await write(root, "bin/deno", "#!/bin/sh\nexit 17\n");
    await chmod(new URL("bin/deno", root), 0o755);
    const result = await runCommand(externalDeno, {
      args: ["task", "readme"],
      cwd: root,
      env: { PATH: `${new URL("bin", root).pathname}:/usr/bin:/bin` },
      stdout: "piped",
      stderr: "piped",
    });
    assert(!result.success);
    assertStringIncludes(await read(root, "README.md"), "# Preserved\n");
    await assertReadOnly(root);
    const names = [];
    for await (const entry of fixtureReadDir(root)) {
      names.push(entry.name);
    }
    assertEquals(names.filter((name) => name.startsWith("README.md.")), []);

    // Git tracks the generated document, but checkout restores writable mode.
    await remove(new URL("README.md", root));
    await git(root, "checkout-index", "--force", "README.md");
    assert((await new LocalFileReader(root).mode("README.md"))! & 0o200);
    await write(root, "bin/deno", "#!/bin/sh\nprintf '# Built\\n'\n");
    const success = await runCommand(externalDeno, {
      args: ["task", "readme"],
      cwd: root,
      env: { PATH: `${new URL("bin", root).pathname}:/usr/bin:/bin` },
      stdout: "piped",
      stderr: "piped",
    });
    assert(success.success);
    assertEquals(await read(root, "README.md"), "# Built\n");
    await assertReadOnly(root);
    await git(root, "ls-files", "--error-unmatch", "README.md");
  });
});

test("clean Git removal skips confirmation but dirty removal requires it", async () => {
  await withRepository(async (root) => {
    await write(root, "README.md", "# Git\n");
    await git(root, "init");
    await git(root, "config", "user.name", "Test User");
    await git(root, "config", "user.email", "test@example.invalid");
    await git(root, "add", "README.md");
    await git(root, "commit", "-m", "docs: add readme");
    await runCli(root, ["repo", "features", "--readme-build"]);
    await runCli(root, ["repo", "features", "--no-readme-build"]);
    assertEquals(await new LocalFileReader(root).exists("readme"), false);

    await runCli(root, ["repo", "features", "--readme-build"]);
    await write(root, "readme/untracked.md", "keep\n");
    await assertRejects(
      () => runCli(root, ["repo", "features", "--no-readme-build"]),
      Error,
      "confirmation required",
    );
    assertEquals(await read(root, "readme/untracked.md"), "keep\n");
    await remove(new URL("readme/untracked.md", root));
    await write(root, ".gitignore", "/readme/ignored.md\n");
    await git(root, "add", ".gitignore");
    await git(root, "commit", "-m", "chore: ignore generated fixture");
    await write(root, "readme/ignored.md", "keep ignored\n");
    await assertRejects(
      () => runCli(root, ["repo", "features", "--no-readme-build"]),
      Error,
      "confirmation required",
    );
    assertEquals(await read(root, "readme/ignored.md"), "keep ignored\n");
  });
});

async function withRepository(run: (root: URL) => Promise<void>) {
  const path = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-readme-build-",
  });
  const root = new URL(`file://${path}/`);
  try {
    await run(root);
  } finally {
    await remove(path, { recursive: true });
  }
}

function write(root: URL, path: string, content: string): Promise<void> {
  return writeTextFile(new URL(path, root), content);
}

function read(root: URL, path: string): Promise<string> {
  return readTextFile(new URL(path, root));
}

async function git(root: URL, ...args: string[]): Promise<void> {
  const result = await runCommand("git", { args, cwd: root });
  assert(result.success, new TextDecoder().decode(result.stderr));
}

async function symlink(target: URL, path: URL): Promise<void> {
  const result = await runCommand("deno", {
    args: [
      "eval",
      "await Deno.symlink(Deno.args[0], Deno.args[1]);",
      target.pathname,
      path.pathname,
    ],
  });
  assert(result.success, new TextDecoder().decode(result.stderr));
}

// Run generated commands explicitly in each test without fetching hj at setup.
function runCli(root: URL, args: readonly string[]) {
  if (args[0] !== "repo" || args[1] !== "features") {
    return executeCli(root, args);
  }
  return runFeatureOperation(
    root,
    parseFeatures(args, builtInFeatureRegistry),
    builtInFeatureRegistry,
    undefined,
    { runFinalTask: () => Promise.resolve(undefined) },
  ).then((output) => ({ output, terminalNewline: true }));
}

async function assertReadOnly(root: URL): Promise<void> {
  const observed = await new LocalFileReader(root).observe("README.md");
  assert(observed.kind === "file");
  assertEquals(fileAccess(observed).writable, false);
}

test("readme-build reports badge drift and repairs source and generated output", async () => {
  await withRepository(async (root) => {
    await runCli(root, ["repo", "features", "--readme-build"]);
    const source =
      "# Project\n\n[![Status](https://example.org/badge.svg)](https://example.org)\n\nIntroduction.\n\n| Area | Details |\n| --- | --- |\n| Code | Tools |\n";
    await write(root, "readme/README.md", source);
    await chmod(new URL("README.md", root), 0o644);
    await write(root, "README.md", source);
    await chmod(new URL("README.md", root), 0o444);
    const inspection = await runCli(root, ["repo", "features"]);
    assertStringIncludes(
      inspection.output.replace(/ +/g, " "),
      "readme-build drifted",
    );
    assertStringIncludes(inspection.output, "first paragraph");
    assertEquals(await read(root, "readme/README.md"), source);
    await assertRejects(() =>
      runCli(root, ["repo", "features", "--readme-build"])
    );
    await runCli(root, [
      "repo",
      "features",
      "--repair",
      "--readme-build",
      "--yes",
    ]);
    const fixed = await read(root, "readme/README.md");
    assert(fixed.indexOf("Introduction.") < fixed.indexOf("[![Status]"));
    assert(fixed.indexOf("[![Status]") < fixed.indexOf("| Area"));
    assertStringIncludes(await read(root, "README.md"), "[![Status]");
    const repeat = await runCli(root, [
      "repo",
      "features",
      "--repair",
      "--readme-build",
      "--yes",
    ]);
    assertStringIncludes(repeat.output, "No changes.");
  });
});
