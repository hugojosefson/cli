import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { LocalFileReader } from "./local-file-reader.ts";
import { LocalGitReader } from "./local-git-reader.ts";

Deno.test("repository commands explain missing Git before optional GitHub checks", async () => {
  await withRepository(async (root) => {
    const output = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-all",
        "--cached-only",
        `--config=${new URL("../../deno.json", import.meta.url).pathname}`,
        new URL("../cli/cli.ts", import.meta.url).pathname,
        "repo",
        "features",
        "--deno-fmt",
        "--yes",
      ],
      cwd: root,
      env: { PATH: "" },
    }).output();
    assertEquals(output.success, false);
    assertEquals(
      new TextDecoder().decode(output.stderr).trim(),
      "Git is required to inspect repositories. Install Git and retry.",
    );
    assertEquals(await new LocalFileReader(root).exists("deno.json"), false);
  });
});

Deno.test("LocalFileReader reads regular files and observes exact artifact kinds", async () => {
  await withRepository(async (root) => {
    await Deno.writeTextFile(new URL("plain.txt", root), "hello\n");
    await Deno.writeTextFile(new URL("data.json", root), '{"answer":42}\n');
    await Deno.writeTextFile(new URL("target.txt", root), "target\n");
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
      (await Deno.lstat(new URL("plain.txt", root))).mode! & 0o777,
    );
    assertEquals(await reader.observe("link"), {
      kind: "symlink",
      target: "target.txt",
    });
    assertEquals(await reader.readText("link"), undefined);
    assertEquals(await reader.observe("missing"), { kind: "absent" });
  });
});

Deno.test("LocalFileReader hashes complete directory state in stable order", async () => {
  await withRepository(async (root) => {
    await Deno.mkdir(new URL("tree/nested/", root), { recursive: true });
    await Deno.writeTextFile(new URL("tree/z.txt", root), "z\n");
    await Deno.writeTextFile(new URL("tree/nested/a.txt", root), "a\n");
    await git(root, ["init", "--initial-branch=main"]);
    await createSymlink(root, "nested/a.txt", "tree/current");
    const reader = new LocalFileReader(root);

    const first = await reader.directoryStateDigest("tree");
    assert(first);
    assertEquals(await reader.directoryStateDigest("tree"), first);
    await Deno.writeTextFile(new URL("tree/nested/a.txt", root), "changed\n");
    assert(await reader.directoryStateDigest("tree") !== first);
    assertEquals((await reader.observe("tree")).kind, "directory");
  });
});

Deno.test("local readers reject roots and paths outside the repository", async () => {
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
    await Deno.mkdir(new URL("linked/", root));
    await git(root, ["init", "--initial-branch=main"]);
    await createSymlink(root, "/tmp", "linked/outside");
    await assertRejects(() => reader.exists("linked/outside/file"), TypeError);
  });
});

Deno.test("LocalGitReader handles non-repositories and unborn HEAD", async () => {
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

Deno.test("LocalGitReader reads status with spaces and renames, remotes, and remote HEAD", async () => {
  await withRepository(async (root) => {
    await git(root, ["init", "--initial-branch=main"]);
    await git(root, ["config", "user.email", "test@example.test"]);
    await git(root, ["config", "user.name", "Test User"]);
    await Deno.writeTextFile(new URL("before name.txt", root), "before\n");
    await git(root, ["add", "."]);
    await git(root, ["commit", "-m", "initial"]);
    await Deno.rename(
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
  const path = await Deno.makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-reader-",
  });
  try {
    await action(new URL(`file://${path}/`));
  } finally {
    await Deno.remove(path, { recursive: true });
  }
}

async function git(root: URL, args: readonly string[]): Promise<string> {
  const output = await new Deno.Command("git", {
    args: [...args],
    cwd: root.pathname,
  }).output();
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
  await Deno.writeTextFile(source, target);
  const blob = (await git(root, ["hash-object", "-w", source.pathname])).trim();
  await git(root, [
    "update-index",
    "--add",
    "--cacheinfo",
    `120000,${blob},${path}`,
  ]);
  await git(root, ["checkout-index", "--force", "--", path]);
  await Deno.remove(source);
}
