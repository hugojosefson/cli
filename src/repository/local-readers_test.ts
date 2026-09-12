import { chmod } from "../testing/files-test-fixtures.ts";
import { runCliProcess } from "../testing/runtime-test-fixtures.ts";
import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import { runRawCommand as runCommand } from "../runtime/command.ts";
import {
  fixtureLstat,
  makeTempDir,
  mkdir,
  remove,
  rename,
  writeTextFile,
} from "../testing/files-test-fixtures.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { LocalFileReader } from "./local-file-reader.ts";
import { LocalGitReader } from "./local-git-reader.ts";

test("repository commands explain missing Git before optional GitHub checks", async () => {
  await withRepository(async (root) => {
    // Bun treats an empty PATH as the system default. An explicit empty directory
    // reliably makes Git unavailable under every supported runtime.
    const emptyPath = new URL("empty-bin/", root);
    await mkdir(emptyPath);
    const output = await runCliProcess([
      "repo",
      "features",
      "--deno-fmt",
      "--yes",
    ], { cwd: root, env: { PATH: emptyPath.pathname } });
    assertEquals(output.success, false);
    assertEquals(
      new TextDecoder().decode(output.stderr).trim(),
      "Git (git) is required. Install it from https://git-scm.com/downloads/, add git to PATH, then retry.",
    );
    assertEquals(await new LocalFileReader(root).exists("deno.json"), false);
  });
});

test("LocalFileReader reads regular files and observes exact artifact kinds", async () => {
  await withRepository(async (root) => {
    await writeTextFile(new URL("plain.txt", root), "hello\n");
    await writeTextFile(new URL("data.json", root), '{"answer":42}\n');
    await writeTextFile(new URL("target.txt", root), "target\n");
    await git(root, ["init", "--initial-branch=main"]);
    await createSymlink(root, "target.txt", "link");
    const reader = new LocalFileReader(root);

    const digest = await reader.digest("plain.txt");
    const jsonDigest = await reader.digest("data.json");
    assert(digest);
    assert(jsonDigest);
    assertEquals(await reader.readText("plain.txt"), "hello\n");
    assertEquals(await reader.readJson("data.json"), {
      value: { answer: 42 },
      digest: jsonDigest,
    });
    assertEquals(
      await reader.mode("plain.txt"),
      (await fixtureLstat(new URL("plain.txt", root))).mode! & 0o777,
    );
    assertEquals(await reader.observe("link"), {
      kind: "symlink",
      target: "target.txt",
    });
    assertEquals(await reader.readText("link"), undefined);
    assertEquals(await reader.observe("missing"), { kind: "absent" });
  });
});

test("the CLI reports missing gh and unattended sign-in before GitHub setup writes", async () => {
  await withRepository(async (root) => {
    const bin = new URL("bin/", root);
    await mkdir(bin);
    const gitPath = await runCommand("sh", {
      args: ["-c", "command -v git"],
      stdout: "piped",
    });
    const link = await runCommand("sh", {
      args: [
        "-c",
        'ln -s "$1" "$2"',
        "hj-test",
        new TextDecoder().decode(gitPath.stdout).trim(),
        new URL("git", bin).pathname,
      ],
    });
    assertEquals(link.success, true);
    const run = () =>
      runCliProcess([
        "repo",
        "features",
        "--github-repo",
        "--yes",
      ], { cwd: root, env: { PATH: bin.pathname }, stdin: "null" });
    const missing = await run();
    assertEquals(missing.success, false);
    assertStringIncludes(
      new TextDecoder().decode(missing.stderr),
      "GitHub CLI (gh) is required. Install it from https://cli.github.com/",
    );
    await writeTextFile(
      new URL("gh", bin),
      '#!/bin/sh\nif [ "$1" = "--version" ]; then exit 0; fi\nexit 1\n',
    );
    await chmod(new URL("gh", bin), 0o755);
    const unsigned = await run();
    assertEquals(unsigned.success, false);
    assertStringIncludes(
      new TextDecoder().decode(unsigned.stderr),
      "Run `gh auth login` in a terminal, then retry.",
    );
    assertEquals(await new LocalGitReader(root).isRepository(), false);
    assertEquals(await new LocalFileReader(root).exists("deno.json"), false);
  });
});

test("LocalFileReader hashes complete directory state in stable order", async () => {
  await withRepository(async (root) => {
    await mkdir(new URL("tree/nested/", root), { recursive: true });
    await writeTextFile(new URL("tree/z.txt", root), "z\n");
    await writeTextFile(new URL("tree/nested/a.txt", root), "a\n");
    await git(root, ["init", "--initial-branch=main"]);
    await createSymlink(root, "nested/a.txt", "tree/current");
    const reader = new LocalFileReader(root);

    const first = await reader.directoryStateDigest("tree");
    assert(first);
    assertEquals(await reader.directoryStateDigest("tree"), first);
    await writeTextFile(new URL("tree/nested/a.txt", root), "changed\n");
    assert(await reader.directoryStateDigest("tree") !== first);
    assertEquals((await reader.observe("tree")).kind, "directory");
  });
});

test("local readers reject roots and paths outside the repository", async () => {
  assertThrows(() =>
    new LocalFileReader(new URL("https://example.test/repo/"))
  );
  assertThrows(() => new LocalGitReader(new URL("https://example.test/repo/")));
  await withRepository(async (root) => {
    const reader = new LocalFileReader(root);
    for (
      const path of [
        "/etc/passwd",
        "../outside",
        "nested/../outside",
        "C:\\outside",
      ]
    ) {
      await assertRejects(() => reader.exists(path), TypeError);
    }
    await mkdir(new URL("linked/", root));
    await git(root, ["init", "--initial-branch=main"]);
    await createSymlink(root, "/tmp", "linked/outside");
    await assertRejects(() => reader.exists("linked/outside/file"), TypeError);
  });
});

test("LocalGitReader handles non-repositories and unborn HEAD", async () => {
  await withRepository(async (root) => {
    const reader = new LocalGitReader(root);
    assertEquals(await reader.isRepository(), false);
    assertEquals(await reader.head(), undefined);
    assertEquals(await reader.status(), undefined);
    assertEquals(await reader.remotes(), []);
    assertEquals(await reader.defaultBranch(), undefined);

    await git(root, ["init", "--initial-branch=main"]);
    assertEquals(await reader.isRepository(), true);
    assertEquals(await reader.head(), undefined);
    assertEquals(await reader.status(), { isClean: true, changedPaths: [] });
  });
});

test("LocalGitReader reads status with spaces and renames, remotes, and remote HEAD", async () => {
  await withRepository(async (root) => {
    await git(root, ["init", "--initial-branch=main"]);
    await git(root, ["config", "user.email", "test@example.test"]);
    await git(root, ["config", "user.name", "Test User"]);
    await writeTextFile(new URL("before name.txt", root), "before\n");
    await git(root, ["add", "."]);
    await git(root, ["commit", "-m", "initial"]);
    await rename(
      new URL("before name.txt", root),
      new URL("after name.txt", root),
    );
    await git(root, ["add", "-A"]);
    await git(root, [
      "remote",
      "add",
      "origin",
      "https://example.test/a remote.git",
    ]);
    await git(root, [
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
      "refs/remotes/origin/main",
    ]);
    const reader = new LocalGitReader(root);

    assertEquals(await reader.head(), {
      commit: (await git(root, ["rev-parse", "HEAD"])).trim(),
      branch: "main",
    });
    assertEquals(await reader.status(), {
      isClean: false,
      changedPaths: ["after name.txt", "before name.txt"],
    });
    assertEquals(await reader.status(["after name.txt"]), {
      isClean: false,
      changedPaths: ["after name.txt"],
    });
    assertEquals(await reader.remotes(), [{
      name: "origin",
      url: "https://example.test/a remote.git",
    }]);
    assertEquals(await reader.defaultBranch(), "main");
  });
});

async function withRepository(
  action: (root: URL) => Promise<void>,
): Promise<void> {
  const path = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-reader-",
  });
  try {
    await action(new URL(`file://${path}/`));
  } finally {
    await remove(path, { recursive: true });
  }
}

async function git(root: URL, args: readonly string[]): Promise<string> {
  const output = await runCommand("git", {
    args: [...args],
    cwd: root.pathname,
  });
  if (!output.success) {
    throw new Error(new TextDecoder().decode(output.stderr));
  }
  return new TextDecoder().decode(output.stdout);
}

async function createSymlink(
  root: URL,
  target: string,
  path: string,
): Promise<void> {
  const source = new URL(".symlink-target", root);
  await writeTextFile(source, target);
  const blob = (await git(root, ["hash-object", "-w", source.pathname])).trim();
  await git(root, [
    "update-index",
    "--add",
    "--cacheinfo",
    `120000,${blob},${path}`,
  ]);
  await git(root, ["checkout-index", "--force", "--", path]);
  await remove(source);
}
