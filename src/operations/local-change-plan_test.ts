import { assertEquals, assertRejects } from "@std/assert";
import type { ChangePlan } from "../api/change-plan.ts";
import type { PlannedChange } from "../api/planned-change.ts";
import { ChangePlanError } from "./change-plan-error.ts";
import { applyLocalChangePlan } from "./local-change-plan.ts";

Deno.test("applicator rejects stale plans before mutations", async () => {
  await withRepository(async (root) => {
    await Deno.writeTextFile(new URL("state.txt", root), "changed");
    await assertRejects(
      () =>
        applyLocalChangePlan(
          root,
          plan([{
            kind: "write-file",
            path: "new.txt",
            content: "new",
            expectedDigest: undefined,
          }], [{ kind: "file-digest", path: "state.txt", digest: "stale" }]),
        ),
      ChangePlanError,
    );
    assertEquals(await text(root, "new.txt"), undefined);
  });
});

Deno.test("applicator preserves JSONC comments and checks existing values", async () => {
  await withRepository(async (root) => {
    await Deno.writeTextFile(
      new URL("deno.jsonc", root),
      '{\n  // keep\n  "old": true\n}\n',
    );
    await applyLocalChangePlan(
      root,
      plan([{
        kind: "set-json",
        path: "deno.jsonc",
        jsonPath: ["new"],
        value: 1,
        expected: undefined,
      }]),
    );
    assertEquals(
      await text(root, "deno.jsonc"),
      '{\n  // keep\n  "old": true,\n  "new": 1\n}\n',
    );
    await applyLocalChangePlan(
      root,
      plan([{
        kind: "remove-json",
        path: "deno.jsonc",
        jsonPath: ["old"],
        expected: true,
      }]),
    );
    assertEquals(
      await text(root, "deno.jsonc"),
      '{\n  "new": 1\n}\n',
    );
  });
});

Deno.test("applicator removes JSON array elements without corrupting JSON", async () => {
  await withRepository(async (root) => {
    await Deno.writeTextFile(new URL("data.json", root), '{"items":[1,2]}\n');
    await applyLocalChangePlan(
      root,
      plan([{
        kind: "remove-json",
        path: "data.json",
        jsonPath: ["items", 1],
        expected: 2,
      }]),
    );
    assertEquals(JSON.parse((await text(root, "data.json"))!), { items: [1] });
  });
});

Deno.test("applicator guards and changes file modes", async () => {
  await withRepository(async (root) => {
    await Deno.writeTextFile(new URL("run", root), "run\n", { mode: 0o644 });
    await applyLocalChangePlan(
      root,
      plan([{
        kind: "set-file-mode",
        path: "run",
        expectedMode: 0o644,
        mode: 0o755,
      }]),
    );
    assertEquals((await Deno.lstat(new URL("run", root))).mode! & 0o777, 0o755);
  });
});

Deno.test("directory creation composes but rejects other existing kinds", async () => {
  await withRepository(async (root) => {
    await applyLocalChangePlan(
      root,
      plan([{ kind: "create-directory", path: "src" }]),
    );
    await applyLocalChangePlan(
      root,
      plan([{ kind: "create-directory", path: "src" }]),
    );
    await Deno.writeTextFile(new URL("file", root), "x");
    await assertRejects(
      () =>
        applyLocalChangePlan(
          root,
          plan([{ kind: "create-directory", path: "file" }]),
        ),
      ChangePlanError,
    );
    await git(root, ["init"]);
    await Deno.writeTextFile(new URL("target", root), "src\n");
    const target = await git(root, ["hash-object", "-w", "target"]);
    await git(root, [
      "update-index",
      "--add",
      "--cacheinfo",
      `120000,${target.trim()},link`,
    ]);
    await git(root, ["checkout-index", "-f", "--", "link"]);
    await assertRejects(
      () =>
        applyLocalChangePlan(
          root,
          plan([{ kind: "create-directory", path: "link" }]),
        ),
      ChangePlanError,
    );
  });
});

Deno.test("applicator initializes and commits a local Git repository", async () => {
  await withRepository(async (root) => {
    await applyLocalChangePlan(
      root,
      plan([{ kind: "git-init", defaultBranch: "main" }]),
    );
    await git(root, ["config", "user.email", "test@example.test"]);
    await git(root, ["config", "user.name", "Test"]);
    await Deno.writeTextFile(new URL("created.txt", root), "created\n");
    await applyLocalChangePlan(
      root,
      plan([{
        kind: "git-commit",
        message: "chore: init",
        paths: ["created.txt"],
        allowEmpty: false,
      }]),
    );
    assertEquals(
      (await git(root, ["rev-parse", "--abbrev-ref", "HEAD"])).trim(),
      "main",
    );
    assertEquals(await git(root, ["show", "HEAD:created.txt"]), "created\n");
    const head = (await git(root, ["rev-parse", "HEAD"])).trim();
    await applyLocalChangePlan(
      root,
      plan([], [
        { kind: "git-repository", exists: true },
        { kind: "git-head", commit: head },
        { kind: "clean-worktree" },
      ]),
    );
    await Deno.writeTextFile(new URL("created.txt", root), "dirty\n");
    await assertRejects(
      () => applyLocalChangePlan(root, plan([], [{ kind: "clean-worktree" }])),
      ChangePlanError,
    );
  });
});

Deno.test("applicator contains paths and rejects remote changes", async () => {
  await withRepository(async (root) => {
    await assertRejects(
      () =>
        applyLocalChangePlan(
          root,
          plan([{ kind: "create-directory", path: "../outside" }]),
        ),
      TypeError,
    );
    await assertRejects(
      () =>
        applyLocalChangePlan(
          root,
          plan([{
            kind: "app-setup",
            name: "x",
            repository: "x",
            environment: "x",
            secretName: "x",
            nonSecretConfiguration: {},
          }]),
        ),
      ChangePlanError,
    );
    await applyLocalChangePlan(root, plan([{ kind: "git-init" }]));
    await assertRejects(
      () =>
        applyLocalChangePlan(
          root,
          plan([{
            kind: "set-git-remote",
            name: "origin",
            url: "https://user@example.test/repository.git",
          }]),
        ),
      ChangePlanError,
    );
  });
});

function plan(
  changes: readonly PlannedChange[],
  preconditions: ChangePlan["preconditions"] = [],
): ChangePlan {
  return {
    featureId: "test",
    action: "enable",
    summary: "test",
    warnings: [],
    preconditions,
    changes,
    validations: [],
  };
}

async function withRepository(
  action: (root: URL) => Promise<void>,
): Promise<void> {
  const path = await Deno.makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-plan-",
  });
  try {
    await action(new URL(`file://${path}/`));
  } finally {
    await Deno.remove(path, { recursive: true });
  }
}

async function text(root: URL, path: string): Promise<string | undefined> {
  try {
    return await Deno.readTextFile(new URL(path, root));
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
}

async function git(root: URL, args: readonly string[]): Promise<string> {
  const output = await new Deno.Command("git", {
    args: [...args],
    cwd: root.pathname,
  }).output();
  if (!output.success) throw new Error("git failed");
  return new TextDecoder().decode(output.stdout);
}
