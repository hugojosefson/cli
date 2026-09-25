import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import {
  chmod,
  mkdir,
  readTextFile,
  writeTextFileSync,
} from "../testing/files-test-fixtures.ts";
import { runRawCommand } from "../runtime/command.ts";
import { lstat, readFile } from "node:fs/promises";
import { parse } from "jsonc-parser";
import { builtInFeatureRegistry } from "../features/built-in-feature-registry.ts";
import { parseFeatures } from "./parse-features.ts";
import { buildReadme } from "../readme/build-readme.ts";
import { CommandFailure } from "./command-failure.ts";
import {
  overwrite,
  overwriteGit as git,
  put,
  withOverwriteRepository,
} from "./overwrite-test-fixtures.ts";

test("overwrite rejects repair and implicit selection", () => {
  for (
    const flags of [["--repair", "--editorconfig"], [], ["--no-editorconfig"], [
      "--editorconfig",
      "--overwrite",
    ], ["--interactive", "--editorconfig"]]
  ) {
    assertThrows(() =>
      parseFeatures(
        ["repo", "features", "--overwrite", ...flags],
        builtInFeatureRegistry,
      )
    );
  }
});

test("overwrite replaces a directory and keeps unborn Git history", async () => {
  await withOverwriteRepository(async (root) => {
    await git(root, ["init"]);
    await git(root, ["config", "user.useConfigOnly", "true"]);
    await put(root, ".editorconfig/custom.txt", "untracked content");
    await put(root, "keep.txt", "keep");
    const messages: string[] = [];
    const result = await overwrite(root, ["--editorconfig"], {
      reportOverwrite: (message) => messages.push(message),
      runFinalTask: async () => {
        await put(root, "task-output.txt", "task output");
        return "passed";
      },
    });
    assertStringIncludes(
      await readTextFile(new URL(".editorconfig", root)),
      "root = true",
    );
    assertEquals(await readTextFile(new URL("keep.txt", root)), "keep");
    assertEquals(
      await readTextFile(new URL("task-output.txt", root)),
      "task output",
    );
    assertStringIncludes(
      messages.join("\n"),
      "Replacement can permanently remove uncommitted and untracked content",
    );
    assertStringIncludes(messages.join("\n"), ".editorconfig");
    assertStringIncludes(result, "git diff --cached");
    assertEquals(await git(root, ["rev-list", "--all", "--count"]), "0");
    await assertRejects(() => readFile(new URL(".git/index", root)), Error);
  });
});

test("overwrite keeps staged content and HEAD while replacing conflicting config", async () => {
  await withOverwriteRepository(async (root) => {
    await git(root, ["init"]);
    await git(root, ["config", "user.name", "Test"]);
    await git(root, ["config", "user.email", "test@example.invalid"]);
    await put(
      root,
      "deno.jsonc",
      '{\n // Keep this comment.\n "tasks": {"fmt": "custom", "other": "echo keep"}, "custom": true\n}\n',
    );
    await git(root, ["add", "."]);
    await git(root, ["commit", "-m", "chore: seed"]);
    await put(root, "staged.txt", "staged");
    await git(root, ["add", "staged.txt"]);
    const head = await git(root, ["rev-parse", "HEAD"]);
    const index = await readFile(new URL(".git/index", root));
    await overwrite(root, ["--deno-fmt"]);
    assertEquals(await git(root, ["rev-parse", "HEAD"]), head);
    assertEquals(await readFile(new URL(".git/index", root)), index);
    const text = await readTextFile(new URL("deno.jsonc", root));
    const config = parse(text);
    assertStringIncludes(text, "Keep this comment");
    assertEquals(config.custom, true);
    assertEquals(config.tasks.other, "echo keep");
    assertEquals(config.tasks.fmt.command, "deno fmt");
    assertEquals(config.fmt.exclude, ["coverage"]);
  });
});

test("overwrite replaces invalid and duplicate Deno configuration", async () => {
  await withOverwriteRepository(async (root) => {
    await put(root, "deno.json", "invalid");
    await put(root, "deno.jsonc", '{"other": true}');
    await overwrite(root, ["--deno-fmt"]);
    assertEquals(
      parse(await readTextFile(new URL("deno.json", root))).tasks.fmt.command,
      "deno fmt",
    );
    await assertRejects(() => lstat(new URL("deno.jsonc", root)), Error);
  });
});

test("overwrite replaces symlink parents without changing external files", async () => {
  await withOverwriteRepository(async (root) => {
    await mkdir(new URL("outside", root));
    await put(root, "outside/editorconfig.json", "outside content");
    await runRawCommand("sh", {
      args: ["-c", 'ln -s "$1" "$2"', "sh", "outside", ".hj"],
      cwd: root,
    });
    await overwrite(root, ["--editorconfig"]);
    assertEquals(
      await readTextFile(new URL("outside/editorconfig.json", root)),
      "outside content",
    );
    assertEquals((await lstat(new URL(".hj", root))).isDirectory(), true);
  });
});

test("overwrite rejects Git metadata inside a directory replacement", async () => {
  await withOverwriteRepository(async (root) => {
    await put(root, ".editorconfig/nested/.git", "gitdir: elsewhere");
    await assertRejects(
      () => overwrite(root, ["--editorconfig"]),
      Error,
      "Git metadata",
    );
    assertEquals(
      await readTextFile(new URL(".editorconfig/nested/.git", root)),
      "gitdir: elsewhere",
    );
  });
});

test("overwrite keeps task exit status and review instructions", async () => {
  await withOverwriteRepository(async (root) => {
    const error = await assertRejects(
      () =>
        overwrite(root, ["--editorconfig"], {
          runFinalTask: () =>
            Promise.reject(new CommandFailure("task failed", 23)),
        }),
      CommandFailure,
    );
    assertEquals(error.exitCode, 23);
    assertStringIncludes(error.message, "commit manually");
    assertStringIncludes(
      await readTextFile(new URL(".editorconfig", root)),
      "root = true",
    );
  });
});

test("overwrite rejects remote setup before local changes", async () => {
  await withOverwriteRepository(async (root) => {
    await put(root, ".editorconfig", "keep");
    await assertRejects(
      () => overwrite(root, ["--editorconfig", "--github-repo"]),
      Error,
      "local files only",
    );
    assertEquals(await readTextFile(new URL(".editorconfig", root)), "keep");
  });
});

test("overwrite validates task output before success", async () => {
  await withOverwriteRepository(async (root) => {
    await put(root, ".editorconfig", "original");
    await assertRejects(
      () =>
        overwrite(root, ["--editorconfig"], {
          runFinalTask: async () => {
            await put(root, ".editorconfig", "broken");
            return "passed";
          },
        }),
      Error,
      "Overwrite validation failed",
    );
  });
});

test("overwrite converts a read-only README into a static README", async () => {
  await withOverwriteRepository(async (root) => {
    await put(root, "README.md", "conflict");
    await chmod(new URL("README.md", root), 0o444);
    await overwrite(root, ["--readme-static"]);
    assertEquals((await lstat(new URL("README.md", root))).mode & 0o200, 0o200);
  });
});

test("overwrite detects a stale file before the first write", async () => {
  await withOverwriteRepository(async (root) => {
    await put(root, ".editorconfig", "original");
    await assertRejects(
      () =>
        overwrite(root, ["--editorconfig"], {
          reportOverwrite: () =>
            writeTextFileSync(
              new URL(".editorconfig", root),
              "concurrent change",
            ),
        }),
      Error,
      "changed after planning",
    );
    assertEquals(
      await readTextFile(new URL(".editorconfig", root)),
      "concurrent change",
    );
    await assertRejects(
      () => lstat(new URL(".hj/editorconfig.json", root)),
      Error,
    );
  });
});

test("overwrite permits commits made by a necessary project task", async () => {
  await withOverwriteRepository(async (root) => {
    await git(root, ["init"]);
    await git(root, ["config", "user.name", "Test"]);
    await git(root, ["config", "user.email", "test@example.invalid"]);
    const result = await overwrite(root, ["--editorconfig"], {
      runFinalTask: async () => {
        await git(root, ["add", "."]);
        await git(root, ["commit", "-m", "chore: task output"]);
        return "passed";
      },
    });
    assertEquals(
      await git(root, ["log", "-1", "--format=%s"]),
      "chore: task output",
    );
    assertStringIncludes(result, "git log -5 --oneline");
  });
});

test("overwrite replaces conflicting library and server files", async () => {
  await withOverwriteRepository(async (root) => {
    await put(
      root,
      "deno.jsonc",
      JSON.stringify({
        tasks: { fmt: "custom" },
        exports: { ".": 42, "./server": false, "./other": "./other.ts" },
      }),
    );
    await put(root, "src/lib/mod.ts/conflict", "remove");
    await put(root, "src/server", "parent conflict");
    await put(root, "other.ts", "export const other = true;\n");
    await overwrite(root, ["--deno-lib", "--deno-server"]);
    assertStringIncludes(
      await readTextFile(new URL("src/lib/mod.ts", root)),
      "placeholder",
    );
    assertStringIncludes(
      await readTextFile(new URL("src/server/server.ts", root)),
      "fetch",
    );
    assertEquals(
      parse(await readTextFile(new URL("deno.jsonc", root))).exports["./other"],
      "./other.ts",
    );
  });
});

test("overwrite creates CLI files over conflicting artifacts", async () => {
  await withOverwriteRepository(async (root) => {
    await put(
      root,
      "deno.json",
      JSON.stringify({
        name: "INVALID NAME",
        hj: { commandName: "INVALID COMMAND", custom: true },
        exports: { "./cli": 7 },
        tasks: { "package-metadata": false },
      }),
    );
    await put(root, "src/cli/cli.ts", "custom conflict");
    await overwrite(root, ["--deno-cli"]);
    assertStringIncludes(
      await readTextFile(new URL("src/cli/cli.ts", root)),
      "DENO_RUN_ARGS",
    );
    assertStringIncludes(
      await readTextFile(new URL("src/cli/package-metadata.json", root)),
      "command",
    );
    assertEquals(
      parse(await readTextFile(new URL("deno.json", root))).hj.custom,
      true,
    );
  });
});

test("overwrite creates a README build and keeps unrelated directory content", async () => {
  await withOverwriteRepository(async (root) => {
    await put(root, "README.md", "custom root");
    await chmod(new URL("README.md", root), 0o444);
    await put(root, "readme/other.txt", "keep");
    await overwrite(root, ["--readme-build"]);
    assertEquals(await readTextFile(new URL("readme/other.txt", root)), "keep");
    assertEquals((await lstat(new URL("README.md", root))).mode & 0o222, 0);
    await overwrite(root, ["--readme-static"]);
    assertEquals((await lstat(new URL("README.md", root))).mode & 0o200, 0o200);
    await assertRejects(() => lstat(new URL("readme/README.md", root)), Error);
    assertEquals(await readTextFile(new URL("readme/other.txt", root)), "keep");
  });
});

test("overwrite initializes Git without a first commit through defaults", async () => {
  await withOverwriteRepository(async (root) => {
    await overwrite(root, ["--defaults"]);
    assertEquals(await git(root, ["rev-list", "--all", "--count"]), "0");
    assertStringIncludes(await readTextFile(new URL("README.md", root)), "#");
  });
});

test("overwrite preserves valid version and replaces invalid task containers", async () => {
  await withOverwriteRepository(async (root) => {
    await put(
      root,
      "deno.json",
      JSON.stringify({ version: "2.4.6", tasks: 4, fmt: { exclude: false } }),
    );
    await overwrite(root, [
      "--deno-config-version",
      "--deno-lint",
      "--deno-test",
      "--deno-typecheck",
    ]);
    const config = parse(await readTextFile(new URL("deno.json", root)));
    assertEquals(config.version, "2.4.6");
    assertEquals(config.fmt.exclude, ["coverage"]);
    assertEquals(typeof config.tasks.coverage, "object");
  });
});

test("overwrite keeps generated README output outside the formatter", async () => {
  await withOverwriteRepository(async (root) => {
    await put(root, "README.md", "# custom   \n\n  text   \n");
    await chmod(new URL("README.md", root), 0o444);
    await overwrite(root, ["--readme-build"], {
      runFinalTask: async () => {
        const result = await runRawCommand("deno", {
          args: ["task", "fmt"],
          cwd: root,
        });
        assertEquals(
          result.success,
          true,
          new TextDecoder().decode(result.stderr),
        );
        await chmod(new URL("README.md", root), 0o644);
        await put(root, "README.md", await buildReadme(root));
        await chmod(new URL("README.md", root), 0o444);
        return "passed";
      },
    });
    const config = parse(await readTextFile(new URL("deno.jsonc", root)));
    assertEquals(config.fmt.exclude, ["coverage", "README.md"]);
  });
});

test("overwrite changes workflow files with read-only GitHub metadata", async () => {
  await withOverwriteRepository(async (root) => {
    await put(root, ".github/workflows/hj-ci.yaml", "custom conflict");
    await put(root, ".github/workflows/keep.yaml", "keep");
    const github = {
      repository: () =>
        Promise.resolve({
          owner: "example",
          name: "project",
          defaultBranch: "main",
        }),
      rulesets: () => Promise.resolve([]),
      environments: () => Promise.resolve([]),
      variables: () => Promise.resolve([]),
      secretExists: () => Promise.resolve(false),
      resource: (kind: string, name: string) =>
        Promise.resolve({
          kind,
          name,
          stateDigest: "state",
          definition: { value: kind === "actions-workflow-permission" },
        }),
      upsertResources: () =>
        Promise.reject(new Error("Unexpected GitHub write")),
      deleteResources: () =>
        Promise.reject(new Error("Unexpected GitHub write")),
    };
    await overwrite(root, ["--github-ci"], { github });
    assertStringIncludes(
      await readTextFile(new URL(".github/workflows/hj-ci.yaml", root)),
      "Generated by hj",
    );
    assertEquals(
      await readTextFile(new URL(".github/workflows/keep.yaml", root)),
      "keep",
    );
    const before = await readTextFile(
      new URL(".github/workflows/hj-ci.yaml", root),
    );
    await assertRejects(
      () => overwrite(root, ["--github-ci", "--github-auto-merge"], { github }),
      Error,
      "local files only",
    );
    assertEquals(
      await readTextFile(new URL(".github/workflows/hj-ci.yaml", root)),
      before,
    );
  });
});

test("overwrite replaces license conflicts and keeps other README sections", async () => {
  const { createSpdxLicenseFeature } = await import(
    "../features/license-spdx-feature.ts"
  );
  const definition = {
    name: "MIT",
    url: "https://example.invalid/MIT",
    placeholders: [],
  };
  const feature = createSpdxLicenseFeature({
    id: "license-mit",
    definition,
    text: () => Promise.resolve("TEST LICENSE FIXTURE\n"),
    alternates: [],
  });
  const registry = {
    ...builtInFeatureRegistry,
    features: [
      ...builtInFeatureRegistry.features.filter((item) =>
        !item.metadata.id.startsWith("license-")
      ),
      feature,
    ],
  };
  await withOverwriteRepository(async (root) => {
    await put(root, "LICENSE", "conflicting test text");
    await put(
      root,
      "README.md",
      "# Project\n\nKeep this text.\n\n## License\n\nCustom link.\n\n## Other\n\nKeep this section.\n",
    );
    await overwrite(root, ["--license-mit"], {
      promptAttribution: () => "Test Holder",
      githubIdentity: { viewer: () => Promise.resolve(undefined) },
    }, registry);
    assertEquals(
      await readTextFile(new URL("LICENSE", root)),
      "TEST LICENSE FIXTURE\n",
    );
    const readme = await readTextFile(new URL("README.md", root));
    assertStringIncludes(readme, "Keep this section.");
    assertStringIncludes(readme, "[MIT](./LICENSE)");
  });
});

test("overwrite corrects local package identity fields without remote changes", async () => {
  const { createSpdxLicenseFeature } = await import(
    "../features/license-spdx-feature.ts"
  );
  const feature = createSpdxLicenseFeature({
    id: "license-mit",
    definition: {
      name: "MIT",
      url: "https://example.invalid/MIT",
      placeholders: [],
    },
    text: () => Promise.resolve("TEST LICENSE FIXTURE\n"),
    alternates: [],
  });
  const registry = {
    ...builtInFeatureRegistry,
    features: [
      ...builtInFeatureRegistry.features.filter((item) =>
        !item.metadata.id.startsWith("license-")
      ),
      feature,
    ],
  };
  await withOverwriteRepository(async (root) => {
    await put(
      root,
      "deno.json",
      JSON.stringify({
        name: "@scope/-bad",
        version: "invalid",
        exports: { ".": "./mod.ts" },
        tasks: { "publish-check": false },
      }),
    );
    await put(root, "mod.ts", "export const value = 1;\n");
    await overwrite(root, [
      "--jsr-package",
      "--deno-lib",
      "--jsr-scope=example",
    ], {
      promptAttribution: () => "Test Holder",
      githubIdentity: { viewer: () => Promise.resolve(undefined) },
      jsrScopes: {
        scopes: () => Promise.resolve({ kind: "missing-authentication" }),
      },
    }, registry);
    const config = parse(await readTextFile(new URL("deno.json", root)));
    assertEquals(config.version, "0.0.0");
    assertStringIncludes(config.name, "@example/");
  });
});
