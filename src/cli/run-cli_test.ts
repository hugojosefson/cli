import {
  isDeno,
  runModuleEval,
  sourceFile,
} from "../testing/runtime-test-fixtures.ts";
import { cp, readdir, symlink } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import {
  makeTempDir,
  mkdir,
  remove,
  writeTextFile,
} from "../testing/files-test-fixtures.ts";
import { runRawCommand as runCommand } from "../runtime/command.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { builtInFeatureRegistry } from "../features/built-in-feature-registry.ts";
import { formatCliOutput } from "./format-output.ts";
import { runCli } from "./run-cli.ts";
import { localReleaseProcess, runOrThrow } from "../release/release-process.ts";
import type { GithubRelease } from "../release/publish-github.ts";

const releaseSha = "a".repeat(40);
const encoder = new TextEncoder();
const moduleChecksum =
  "sha256-2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881";

function publisherDependencies() {
  const processCalls: string[] = [];
  let jsrReads = 0;
  let githubReads = 0;
  let githubCreates = 0;
  let created: GithubRelease | undefined;
  const environment = {
    get: (name: string) =>
      ({
        HJ_RELEASE_ROUTE: "event",
        HJ_RELEASE_SCHEMA: "1",
        HJ_RELEASE_TAG: "1.2.3",
        HJ_RELEASE_VERSION: "1.2.3",
        HJ_RELEASE_SHA: releaseSha,
        GITHUB_REPOSITORY: "owner/repo",
      })[name],
  };
  const releaseProcess = {
    run: (command: string, args: readonly string[]) => {
      processCalls.push(`${command} ${args.join(" ")}`);
      const output = command === "git" && args[0] === "status"
        ? ""
        : command === "git" && args[0] === "ls-remote"
        ? `${releaseSha}\trefs/tags/1.2.3\n`
        : command === "git" && args[0] === "show"
        ? "## 1.2.3\nnotes\n"
        : `${releaseSha}\n`;
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: encoder.encode(output),
        stderr: new Uint8Array(),
      });
    },
  };
  const publisherFiles = {
    observe: (path: "deno.json" | "deno.jsonc") =>
      Promise.resolve(
        path === "deno.json"
          ? {
            kind: "file" as const,
            bytes: encoder.encode(
              '{"name":"@owner/repo","version":"1.2.3","exports":"./mod.ts"}',
            ),
          }
          : { kind: "absent" as const },
      ),
  };
  return {
    dependencies: {
      releaseEnvironment: environment,
      releaseProcess,
      publisherFiles,
      packageFiles: { read: () => Promise.resolve(encoder.encode("x")) },
      jsrApi: {
        version: () => {
          jsrReads++;
          return Promise.resolve({
            manifest: { "/mod.ts": { size: 1, checksum: moduleChecksum } },
            manifestDigest: "b".repeat(64),
            moduleGraph2: { "/mod.ts": {} },
            exports: { ".": "./mod.ts" },
            rekorLogId: 1,
          });
        },
        verifyProvenance: () => Promise.resolve(),
      },
      githubReleaseApi: {
        read: () => {
          githubReads++;
          return Promise.resolve(created);
        },
        create: (input: GithubRelease) => {
          githubCreates++;
          created = input;
          return Promise.resolve();
        },
      },
    },
    state: () => ({ processCalls, jsrReads, githubReads, githubCreates }),
  };
}

test("dispatches README builds and rejects extra arguments", async () => {
  const path = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-cli-",
  });
  const root = new URL(`file://${path}/`);
  try {
    await mkdir(new URL("readme", root));
    await writeTextFile(new URL("readme/README.md", root), "# default\n");
    await writeTextFile(new URL("other.md", root), "# other");
    assertEquals(
      formatCliOutput(await runCli(root, ["readme", "build"])),
      "# default\n",
    );
    assertEquals(
      formatCliOutput(await runCli(root, ["readme", "build", "other.md"])),
      "# other",
    );
    assertEquals(
      formatCliOutput(
        await runCli(root, ["readme", "build", "other.md"], {
          colors: { stdout: true, stderr: true },
        }),
      ),
      "# other",
    );
    await assertRejects(
      () => runCli(root, ["readme", "build", "other.md", "extra"]),
      Error,
      "expected `hj readme build [input]`",
    );
  } finally {
    await remove(path, { recursive: true });
  }
});

test("keeps repo features dispatch", async () => {
  const path = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-cli-",
  });
  const root = new URL(`file://${path}/`);
  try {
    assertEquals(
      formatCliOutput(await runCli(root, ["repo", "features"])).trimEnd().split(
        "\n",
      ).slice(2).filter((line) => /^\S/.test(line)).map((line) =>
        line.trim().split(/ +/).slice(0, 2).join(": ")
      )
        .join("\n") + "\n",
      builtInFeatureRegistry.features.map((feature) => feature.metadata.id)
        .sort().map((id) => `${id}: disabled`).join("\n") + "\n",
    );
    const colored = await runCli(root, ["repo", "features"], {
      colors: { stdout: true },
    });
    assertStringIncludes(colored.output, "\x1b[2mdisabled\x1b[0m");
    await writeTextFile(
      new URL("deno.json", root),
      '{"tasks":{"fmt":"echo custom"}}',
    );
    const error = await assertRejects(
      () =>
        runCli(root, ["repo", "features", "--deno-fmt"], {
          colors: { stdout: false, stderr: true },
          globalConfigFile: new URL("missing-config.json", root),
        }),
      Error,
    );
    assertStringIncludes(error.message, "\x1b[1mIssue\x1b[0m");
    assertStringIncludes(error.message, "\x1b[31m");
  } finally {
    await remove(path, { recursive: true });
  }
});

test("dispatches source validation without a trailing root slash", async () => {
  const path = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-cli-release-",
  });
  const root = new URL(`file://${path}/`);
  try {
    const process = localReleaseProcess(root);
    await runOrThrow(process, "git", ["init", "--initial-branch=main"]);
    await runOrThrow(process, "git", ["config", "user.name", "Test"]);
    await runOrThrow(process, "git", [
      "config",
      "user.email",
      "test@example.invalid",
    ]);
    await writeTextFile(new URL("base.txt", root), "base\n");
    await runOrThrow(process, "git", ["add", "base.txt"]);
    await runOrThrow(process, "git", ["commit", "-m", "chore: base"]);
    const base = (await runOrThrow(process, "git", ["rev-parse", "HEAD"]))
      .trim();
    await writeTextFile(new URL("feature.txt", root), "feature\n");
    await runOrThrow(process, "git", ["add", "feature.txt"]);
    await runOrThrow(process, "git", ["commit", "-m", "feat: feature"]);
    const head = (await runOrThrow(process, "git", ["rev-parse", "HEAD"]))
      .trim();
    const environment = new Map([
      ["HJ_RELEASE_ROUTE", "source-validation"],
      ["HJ_SOURCE_BASE_SHA", base],
      ["HJ_SOURCE_HEAD_SHA", head],
    ]);
    assertEquals(
      formatCliOutput(
        await runCli(
          new URL(`file://${path}`),
          ["release", "publish-tag-prepare"],
          {
            releaseEnvironment: { get: (name) => environment.get(name) },
            releaseProcess: process,
          },
        ),
      ),
      "Source commits are valid.\n",
    );
  } finally {
    await remove(path, { recursive: true });
  }
});

test("rejects apply bundles and extra release arguments before process effects", async () => {
  let called = false;
  const dependencies = {
    releaseEnvironment: {
      get: (name: string) =>
        name === "HJ_RELEASE_BUNDLE"
          ? "bad"
          : name === "HJ_RELEASE_BUNDLE_DIGEST"
          ? "0".repeat(64)
          : name === "GITHUB_REPOSITORY"
          ? "owner/repo"
          : undefined,
    },
    releaseProcess: {
      run: () => {
        called = true;
        return Promise.reject(new Error("unexpected"));
      },
    },
  };
  await assertRejects(() =>
    runCli(
      new URL("file:///tmp/opencode/"),
      ["release", "publish-tag-apply"],
      dependencies,
    )
  );
  assertEquals(called, false);
  await assertRejects(
    () =>
      runCli(
        new URL("file:///tmp/opencode/"),
        ["release", "publish-tag-apply", "extra"],
        dependencies,
      ),
    Error,
    "expected `hj release publish-tag-apply`",
  );
});

test("dispatches publisher commands with injected dependencies and no cross-call", async () => {
  const jsr = publisherDependencies();
  assertEquals(
    formatCliOutput(
      await runCli(
        new URL("file:///tmp/opencode/"),
        ["release", "publish-jsr"],
        jsr.dependencies,
      ),
    ),
    "JSR publication finished.\n",
  );
  assertEquals(jsr.state().githubReads, 0);
  assertEquals(jsr.state().githubCreates, 0);
  assertEquals(jsr.state().jsrReads, 1);
  const github = publisherDependencies();
  assertEquals(
    formatCliOutput(
      await runCli(new URL("file:///tmp/opencode/"), [
        "release",
        "publish-github",
      ], github.dependencies),
    ),
    "GitHub Release publication finished.\n",
  );
  assertEquals(github.state().jsrReads, 0);
  assertEquals(github.state().githubReads, 2);
  assertEquals(github.state().githubCreates, 1);
});

test("rejects extra publisher arguments before injected process or APIs run", async () => {
  for (const command of ["publish-jsr", "publish-github"]) {
    const fixture = publisherDependencies();
    await assertRejects(
      () =>
        runCli(
          new URL("file:///tmp/opencode/"),
          ["release", command, "extra"],
          fixture.dependencies,
        ),
      Error,
      `expected \`hj release ${command}\``,
    );
    assertEquals(fixture.state(), {
      processCalls: [],
      jsrReads: 0,
      githubReads: 0,
      githubCreates: 0,
    });
  }
});

test("loads fork-version only for usual tag preparation", async () => {
  const path = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-runtime-import-",
  });
  try {
    const trapCode =
      'throw new Error("fork-version loaded");\nexport class Logger {}\nexport function getNextVersion() {}\n';
    if (!isDeno) {
      const emittedRoot = new URL("../../", import.meta.url);
      const isolatedRoot = pathToFileURL(`${path}/app/`);
      await cp(emittedRoot, isolatedRoot, { recursive: true });
      await writeTextFile(`${path}/package.json`, '{"type":"module"}');
      await mkdir(`${path}/app/node_modules/fork-version`, { recursive: true });
      const dependencies = new URL("../node_modules/", emittedRoot);
      for (const name of await readdir(dependencies)) {
        if (name === "fork-version") continue;
        await symlink(
          new URL(name, dependencies),
          `${path}/app/node_modules/${name}`,
        );
      }
      await writeTextFile(
        `${path}/app/node_modules/fork-version/package.json`,
        '{"type":"module","exports":"./index.js"}',
      );
      await writeTextFile(
        `${path}/app/node_modules/fork-version/index.js`,
        trapCode,
      );
      const result = await runModuleEval(
        runtimeIsolationScript(
          new URL("src/cli/run-cli.js", isolatedRoot).href,
        ),
      );
      if (!result.success) {
        throw new Error(new TextDecoder().decode(result.stderr));
      }
      return;
    }
    const config = `${path}/deno.json`;
    const trap = `${path}/trap.ts`;
    const script = `${path}/isolation.ts`;
    await writeTextFile(
      config,
      JSON.stringify({
        imports: {
          "@std/assert": "jsr:@std/assert@^1.0.19",
          "@std/path": "jsr:@std/path@^1.1.3",
          "fork-version": "./trap.ts",
          "conventional-commits-parser":
            "npm:conventional-commits-parser@7.1.2",
          "conventional-changelog-writer":
            "npm:conventional-changelog-writer@9.2.1",
          "jsonc-parser": "npm:jsonc-parser@3.3.1",
        },
      }),
    );
    await writeTextFile(
      trap,
      trapCode,
    );
    await writeTextFile(
      script,
      runtimeIsolationScript(sourceFile("src/cli/run-cli.ts").href),
    );
    const result = await runCommand("deno", {
      args: [
        "run",
        "--quiet",
        "--no-check",
        "--cached-only",
        `--config=${config}`,
        script,
      ],
      stdout: "piped",
      stderr: "piped",
    });
    if (!result.success) {
      throw new Error(new TextDecoder().decode(result.stderr));
    }
  } finally {
    await remove(path, { recursive: true });
  }
});

function runtimeIsolationScript(runCliUrl: string): string {
  return `import { runCli } from ${JSON.stringify(runCliUrl)};
const sha = "a".repeat(40);
const result = (stdout = "") => ({
  success: true,
  code: 0,
  stdout: new TextEncoder().encode(stdout),
  stderr: new Uint8Array(),
});
const process = {
  run: (_command, args) => Promise.resolve(result(
    args[0] === "merge-base" ? sha + "\\n" : "",
  )),
};
const sourceEnvironment = {
  get: (name) => ({
    HJ_RELEASE_ROUTE: "source-validation",
    HJ_SOURCE_BASE_SHA: sha,
    HJ_SOURCE_HEAD_SHA: sha,
  })[name],
};
const source = await runCli(
  new URL("file:///tmp/opencode/"),
  ["release", "publish-tag-prepare"],
  { releaseEnvironment: sourceEnvironment, releaseProcess: process },
);
if (source.output !== "Source commits are valid.") throw new Error("source route failed");
const rejectWithoutForkVersion = async (args, dependencies) => {
  try {
    await runCli(new URL("file:///tmp/opencode/"), args, dependencies);
  } catch (error) {
    if (String(error).includes("fork-version loaded")) throw error;
    return;
  }
  throw new Error("route unexpectedly succeeded");
};
await rejectWithoutForkVersion(
  ["release", "publish-tag-apply"],
  {
    releaseEnvironment: {
      get: (name) => ({
        HJ_RELEASE_BUNDLE: "bad",
        HJ_RELEASE_BUNDLE_DIGEST: "0".repeat(64),
        GITHUB_REPOSITORY: "owner/repo",
      })[name],
    },
    releaseProcess: process,
  },
);
const invalidPublisher = {
  releaseEnvironment: { get: () => undefined },
  releaseProcess: process,
  publisherFiles: { observe: () => Promise.resolve({ kind: "absent" }) },
  packageFiles: { read: () => Promise.resolve(new Uint8Array()) },
  jsrApi: {
    version: () => Promise.resolve(undefined),
    verifyProvenance: () => Promise.resolve(),
  },
  githubReleaseApi: {
    read: () => Promise.resolve(undefined),
    create: () => Promise.resolve(),
  },
};
await rejectWithoutForkVersion(["release", "publish-jsr"], invalidPublisher);
await rejectWithoutForkVersion(["release", "publish-github"], invalidPublisher);
let trapped = false;
try {
  await runCli(
    new URL("file:///tmp/opencode/"),
    ["release", "publish-tag-prepare"],
    {
      releaseEnvironment: { get: (name) => name === "HJ_RELEASE_ROUTE" ? "usual" : undefined },
      releaseProcess: process,
    },
  );
} catch (error) {
  trapped = String(error).includes("fork-version loaded");
}
if (!trapped) throw new Error("usual preparation did not load fork-version");
`;
}

test("help needs no repository, credentials, or release side effects", async () => {
  const root = new URL("file:///tmp/opencode/nonexistent-help-root/");
  const services = {
    releaseEnvironment: {
      get: () => {
        throw new Error("unexpected environment access");
      },
    },
  };
  for (
    const args of [[], ["--help"], ["-h"], ["repo", "features", "--help"], [
      "release",
      "publish-tag-apply",
      "--help",
    ]]
  ) {
    const result = await runCli(root, args, services);
    assertEquals(result.terminalNewline, true);
    assertEquals(result.output.includes("hj"), true);
  }
  await assertRejects(
    () => runCli(root, ["config", "unknown"], services),
    Error,
    "Unknown command",
  );
  await assertRejects(
    () => runCli(root, ["release", "publish-jsr", "--help", "extra"], services),
    Error,
    "expected",
  );
});

test("executable help works without application permissions", async () => {
  const output = await runCommand("deno", {
    args: [
      "run",
      "--frozen",
      sourceFile("src/cli/cli.ts").href,
      "--help",
    ],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  });
  assertEquals(output.success, true, new TextDecoder().decode(output.stderr));
  assertEquals(
    new TextDecoder().decode(output.stdout).includes("hj repo features"),
    true,
  );
});
