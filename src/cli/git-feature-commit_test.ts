import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import {
  chmod,
  makeTempDir,
  mkdir,
  readTextFile,
  remove as removeFixture,
  writeTextFile,
} from "../testing/files-test-fixtures.ts";
import { runRawCommand as runCommand } from "../runtime/command.ts";
import { assert, assertEquals, assertRejects } from "@std/assert";
import type { ChangePlan } from "../api/change-plan.ts";
import { FeatureCommitSession } from "./git-feature-commit.ts";

test("feature commits separate shared JSON and README edits after final formatting", async () => {
  await repository(async (root) => {
    const first = plan("first", ["deno.jsonc", "README.md"]);
    const second = plan("second", ["deno.jsonc", "README.md"]);
    const session =
      (await FeatureCommitSession.prepare(root, [first, second]))!;
    await session.initialize();
    assertEquals(await git(root, "log", "--format=%s"), "chore: init repo");
    await write(root, "deno.jsonc", '{"first":true}\n');
    await write(root, "README.md", "# First\n");
    await session.capture(first);
    await write(root, "deno.jsonc", '{"first":true,"second":true}\n');
    await write(root, "README.md", "# First\n\nSecond.\n");
    await session.capture(second);
    await write(root, "deno.jsonc", '{ "first": true, "second": true }\n');
    assertEquals(await git(root, "rev-list", "--count", "HEAD"), "1");
    assert(await session.finish());
    assertEquals(
      await git(root, "log", "--reverse", "--format=%s"),
      "chore: init repo\nchore(first): enable feature\nchore(second): enable feature",
    );
    assertEquals(JSON.parse(await git(root, "show", "HEAD~1:deno.jsonc")), {
      first: true,
    });
    assertEquals(await git(root, "show", "HEAD~1:README.md"), "# First");
    assertEquals(await git(root, "status", "--porcelain"), "");
  });
});

test("feature commits preserve unrelated staged and working edits including unborn index", async () => {
  await repository(async (root) => {
    await write(root, "staged.txt", "staged\n");
    await git(root, "add", "staged.txt");
    await write(root, "staged.txt", "working\n");
    const change = plan("readme-static", ["README.md"]);
    const session = (await FeatureCommitSession.prepare(root, [change]))!;
    await session.initialize();
    await write(root, "README.md", "# Project\n");
    await session.capture(change);
    await session.finish();
    assertEquals(
      await git(root, "ls-tree", "--name-only", "HEAD"),
      "README.md",
    );
    assertEquals(await git(root, "show", ":staged.txt"), "staged");
    assertEquals(
      await readTextFile(new URL("staged.txt", root)),
      "working\n",
    );
    assertEquals(await git(root, "status", "--porcelain"), "AM staged.txt");
    const head = await git(root, "rev-parse", "HEAD");
    const again = (await FeatureCommitSession.prepare(root, [change]))!;
    await again.initialize();
    await again.capture(change);
    assertEquals(await again.finish(), false);
    assertEquals(await git(root, "rev-parse", "HEAD"), head);
  });
});

test("feature commits include repair, deletion, symlinks, and executable mode changes", async () => {
  await repository(async (root) => {
    await write(root, "script.ts", "old\n");
    await write(root, "remove.txt", "remove\n");
    await git(root, "add", ".");
    await git(root, "commit", "-m", "chore: seed");
    const repair = plan("script", ["script.ts", "link"]);
    const remove = {
      ...plan("obsolete", ["remove.txt"]),
      action: "disable" as const,
    };
    const session =
      (await FeatureCommitSession.prepare(root, [repair, remove]))!;
    await session.initialize();
    await write(root, "script.ts", "fixed\n");
    await chmod(new URL("script.ts", root), 0o755);
    const linked = await runCommand("deno", {
      args: ["eval", 'await Deno.symlink("script.ts", "link")'],
      cwd: root,
    });
    assert(linked.success);
    await session.capture(repair);
    await removeFixture(new URL("remove.txt", root));
    await session.capture(remove);
    await session.finish();
    assertEquals(
      await git(root, "log", "-2", "--format=%s"),
      "chore(obsolete): disable feature\nchore(script): enable feature",
    );
    assert(
      (await git(root, "ls-tree", "HEAD", "script.ts")).startsWith("100755"),
    );
    assert((await git(root, "ls-tree", "HEAD", "link")).startsWith("120000"));
    assertEquals(await git(root, "status", "--porcelain"), "");
  });
});

test("ambiguous final task edits create no pending content commits and preserve files", async () => {
  await repository(async (root) => {
    await write(root, "keep.txt", "original\n");
    await git(root, "add", ".");
    await git(root, "commit", "-m", "chore: seed");
    const change = plan("feature", ["new.txt"]);
    const head = await git(root, "rev-parse", "HEAD");
    const session = (await FeatureCommitSession.prepare(root, [change]))!;
    await write(root, "new.txt", "new\n");
    await session.capture(change);
    await write(root, "keep.txt", "task touched unrelated file\n");
    await assertRejects(() => session.finish(), Error, "cannot be attributed");
    assertEquals(await git(root, "rev-parse", "HEAD"), head);
    assertEquals(await git(root, "diff", "--cached"), "");
    assertEquals(await readTextFile(new URL("new.txt", root)), "new\n");
  });
});

test("planned dirty paths stop before mutation and preserve their index", async () => {
  await repository(async (root) => {
    await write(root, "file.txt", "old\n");
    await git(root, "add", ".");
    await git(root, "commit", "-m", "chore: seed");
    await write(root, "file.txt", "user edit\n");
    await git(root, "add", "file.txt");
    await assertRejects(
      () => FeatureCommitSession.prepare(root, [plan("feature", ["file.txt"])]),
      Error,
      "existing edits",
    );
    assertEquals(await git(root, "show", ":file.txt"), "user edit");
  });
});

test("configured coverage stays untracked without a gitignore feature", async () => {
  await repository(async (root) => {
    const change = plan("deno-test", ["deno.jsonc"]);
    const session = (await FeatureCommitSession.prepare(root, [change]))!;
    await session.initialize();
    await write(
      root,
      "deno.jsonc",
      '{"tasks":{"test":"deno test --coverage=coverage"}}\n',
    );
    await session.capture(change);
    await mkdir(new URL("coverage", root));
    await write(root, "coverage/output.json", "{}\n");
    await session.finish();
    assertEquals(
      await git(root, "ls-tree", "-r", "--name-only", "HEAD"),
      "deno.jsonc",
    );
    assertEquals(await git(root, "status", "--porcelain"), "?? coverage/");
  });
});

test("owned lock task outputs belong to sidecar owner alongside other features", async () => {
  await repository(async (root) => {
    const cli = plan("deno-cli", [".hj/deno-lock.json"]);
    const readme = plan("readme-static", ["README.md"]);
    const session = (await FeatureCommitSession.prepare(root, [cli, readme]))!;
    await session.initialize();
    await mkdir(new URL(".hj", root));
    await write(root, ".hj/deno-lock.json", "{}\n");
    await session.capture(cli);
    await write(root, "README.md", "# Project\n");
    await session.capture(readme);
    await write(root, "deno.lock", '{"version":"5"}\n');
    await write(root, ".hj/deno-lock.json", '{"digest":"new"}\n');
    await session.finish();
    assertEquals(
      await git(root, "show", "HEAD~1:deno.lock"),
      '{"version":"5"}',
    );
    assertEquals(await git(root, "status", "--porcelain"), "");
  });
});

test("adding gitignore does not attribute ignored existing files as deleted", async () => {
  await repository(async (root) => {
    await write(root, "local.txt", "keep\n");
    const change = plan("git-ignore", [".gitignore"]);
    const session = (await FeatureCommitSession.prepare(root, [change]))!;
    await session.initialize();
    await write(root, ".gitignore", "local.txt\n");
    await session.capture(change);
    await session.finish();
    assertEquals(
      await git(root, "ls-tree", "--name-only", "HEAD"),
      ".gitignore",
    );
    assertEquals(await readTextFile(new URL("local.txt", root)), "keep\n");
  });
});

function plan(featureId: string, paths: string[]): ChangePlan {
  return {
    featureId,
    action: "enable",
    summary: featureId,
    warnings: [],
    preconditions: [],
    validations: [],
    changes: paths.map((path) => ({
      kind: "write-file",
      path,
      content: "",
      mode: 0o644,
      expectedDigest: undefined,
    })),
  };
}
async function write(root: URL, path: string, content: string) {
  await writeTextFile(new URL(path, root), content);
}
async function git(root: URL, ...args: string[]): Promise<string> {
  const result = await runCommand("git", { args, cwd: root });
  assert(result.success, new TextDecoder().decode(result.stderr));
  return new TextDecoder().decode(result.stdout).trim();
}
async function repository(action: (root: URL) => Promise<void>) {
  const path = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-commits-",
  });
  const root = new URL(`file://${path}/`);
  try {
    await git(root, "init");
    await git(root, "config", "user.name", "Test User");
    await git(root, "config", "user.email", "test@example.invalid");
    await action(root);
  } finally {
    await removeFixture(root, { recursive: true });
  }
}

test("scoped lock capture leaves unrelated task changes for attribution checks", async () => {
  await repository(async (root) => {
    const change = plan("deno-cli", [".hj/deno-lock.json"]);
    const session = (await FeatureCommitSession.prepare(root, [change]))!;
    await session.initialize();
    await mkdir(new URL(".hj", root));
    await write(root, ".hj/deno-lock.json", "{}\n");
    await session.capture(change);
    await write(root, "deno.lock", "{}\n");
    await write(root, "unrelated.txt", "not owned\n");
    await session.capture(change, ["deno.lock"]);
    await assertRejects(() => session.finish(), Error, "cannot be attributed");
    assertEquals(await git(root, "rev-list", "--count", "HEAD"), "1");
    assertEquals(await git(root, "diff", "--cached"), "");
  });
});

test("shared task rewrites with ambiguous ownership keep all content uncommitted", async () => {
  await repository(async (root) => {
    const a = plan("first", ["shared.txt"]);
    const b = plan("second", ["shared.txt"]);
    const session = (await FeatureCommitSession.prepare(root, [a, b]))!;
    await session.initialize();
    await write(root, "shared.txt", "first\n");
    await session.capture(a);
    await write(root, "shared.txt", "first\nsecond\n");
    await session.capture(b);
    await write(root, "shared.txt", "unattributable rewrite\n");
    await assertRejects(() => session.finish(), Error, "cannot be attributed");
    assertEquals(await git(root, "rev-list", "--count", "HEAD"), "1");
    assertEquals(
      await readTextFile(new URL("shared.txt", root)),
      "unattributable rewrite\n",
    );
  });
});

test("explicit generated paths are captured even under existing ignore rules", async () => {
  await repository(async (root) => {
    await write(root, ".gitignore", "generated.txt\n");
    await git(root, "add", ".gitignore");
    await git(root, "commit", "-m", "chore: seed");
    const change = plan("generated", ["generated.txt"]);
    const session = (await FeatureCommitSession.prepare(root, [change]))!;
    await write(root, "generated.txt", "owned output\n");
    await session.capture(change);
    await session.finish();
    assertEquals(await git(root, "show", "HEAD:generated.txt"), "owned output");
    assertEquals(await git(root, "status", "--porcelain"), "");
  });
});

test("private commit indexes work in a linked Git worktree", async () => {
  await repository(async (root) => {
    await write(root, "seed.txt", "seed\n");
    await git(root, "add", ".");
    await git(root, "commit", "-m", "chore: seed");
    await git(root, "worktree", "add", "-b", "linked", "linked");
    const linked = new URL("linked/", root);
    const change = plan("readme-static", ["README.md"]);
    const session = (await FeatureCommitSession.prepare(linked, [change]))!;
    await write(linked, "README.md", "# Linked\n");
    await session.capture(change);
    await session.finish();
    assertEquals(await git(linked, "show", "HEAD:README.md"), "# Linked");
    assertEquals(await git(linked, "status", "--porcelain"), "");
    assertEquals(await git(root, "log", "-1", "--format=%s"), "chore: seed");
  });
});
