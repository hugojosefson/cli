import { assert, assertEquals, assertRejects } from "@std/assert";
import type { FeatureRegistry } from "../features/feature-registry.ts";
import { builtInFeatureRegistry } from "../features/built-in-feature-registry.ts";
import { parseFeatures } from "./parse-features.ts";
import { runFeatureOperation, runFeatures } from "./run-features.ts";

Deno.test("reports status and commits only planned README changes", async () => {
  await withRepository(async (root) => {
    await git(["init"], root);
    await git(["config", "user.name", "Test User"], root);
    await git(["config", "user.email", "test@example.invalid"], root);
    await Deno.writeTextFile(new URL("keep.txt", root), "keep\n");
    await git(["add", "keep.txt"], root);
    await git(["commit", "-m", "chore: seed"], root);

    const status = await runFeatures(
      root,
      parseFeatures(["repo", "features"], builtInFeatureRegistry),
    );
    assertEquals(
      status,
      "deno-cli: disabled\ndeno-fmt: disabled\ndeno-lib: disabled\ndeno-lint: disabled\ndeno-server: disabled\ndeno-test: disabled\ndeno-typecheck: disabled\ngit: enabled\nlicense-mit: disabled\nreadme-build: disabled\nreadme-static: disabled",
    );
    const enabled = await runFeatures(
      root,
      parseFeatures(["repo", "features", "--readme"], builtInFeatureRegistry),
    );
    assert(enabled.includes("Created one commit"));
    assertEquals(
      await gitText(["log", "--format=%s", "-1"], root),
      "chore: configure repository features",
    );
    assertEquals(
      await gitText(["show", "--format=", "--name-only", "HEAD"], root),
      "README.md",
    );

    const disabled = await runFeatures(
      root,
      parseFeatures(
        ["repo", "features", "--no-readme"],
        builtInFeatureRegistry,
      ),
    );
    assert(disabled.includes("Created one commit"));
    assertEquals(await gitText(["rev-list", "--count", "HEAD"], root), "3");
    assertEquals(
      await gitText(["show", "--format=", "--name-only", "HEAD"], root),
      "README.md",
    );
    assertEquals((await Deno.stat(new URL("keep.txt", root))).isFile, true);
  });
});

Deno.test("repair preserves writable static README content", async () => {
  await withRepository(async (root) => {
    await git(["init"], root);
    await git(["config", "user.name", "Test User"], root);
    await git(["config", "user.email", "test@example.invalid"], root);
    await Deno.writeTextFile(new URL("README.md", root), "# edited\n");
    await Deno.chmod(new URL("README.md", root), 0o755);
    await git(["add", "README.md"], root);
    await git(["commit", "-m", "chore: seed"], root);

    const result = await runFeatures(
      root,
      parseFeatures(
        ["repo", "features", "--repair"],
        builtInFeatureRegistry,
      ),
    );
    assert(!result.includes("Created one commit"));
    assertEquals(
      await Deno.readTextFile(new URL("README.md", root)),
      "# edited\n",
    );
    assertEquals(
      (await Deno.stat(new URL("README.md", root))).mode! & 0o777,
      0o755,
    );
    assertEquals(
      await gitText(["show", "--format=", "--name-only", "HEAD"], root),
      "README.md",
    );
  });
});

Deno.test("commits planned deno-fmt changes through the generic Git path", async () => {
  await withRepository(async (root) => {
    await git(["init"], root);
    await git(["config", "user.name", "Test User"], root);
    await git(["config", "user.email", "test@example.invalid"], root);
    await Deno.writeTextFile(new URL("keep.txt", root), "keep\n");
    await git(["add", "keep.txt"], root);
    await git(["commit", "-m", "chore: seed"], root);

    const result = await runFeatures(
      root,
      parseFeatures(
        ["repo", "features", "--deno-fmt"],
        builtInFeatureRegistry,
      ),
    );
    assert(result.includes("Created one commit"));
    assertEquals(
      await gitText(["show", "--format=", "--name-only", "HEAD"], root),
      "deno.jsonc",
    );
  });
});

Deno.test("commits planned deno-lib files through the generic Git path", async () => {
  await withRepository(async (root) => {
    await git(["init"], root);
    await git(["config", "user.name", "Test User"], root);
    await git(["config", "user.email", "test@example.invalid"], root);
    await Deno.writeTextFile(new URL("keep.txt", root), "keep\n");
    await git(["add", "keep.txt"], root);
    await git(["commit", "-m", "chore: seed"], root);
    const result = await runFeatures(
      root,
      parseFeatures(
        ["repo", "features", "--deno-lib"],
        builtInFeatureRegistry,
      ),
    );
    assert(result.includes("Created one commit"));
    assertEquals(
      await gitText(["show", "--format=", "--name-only", "HEAD"], root),
      "deno.jsonc\nsrc/lib/mod.ts\ntest/lib_test.ts",
    );
  });
});

Deno.test("commits planned deno-cli files through the generic Git path", async () => {
  await withRepository(async (root) => {
    await git(["init"], root);
    await git(["config", "user.name", "Test User"], root);
    await git(["config", "user.email", "test@example.invalid"], root);
    await Deno.writeTextFile(new URL("keep.txt", root), "keep\n");
    await git(["add", "keep.txt"], root);
    await git(["commit", "-m", "chore: seed"], root);
    const result = await runFeatures(
      root,
      parseFeatures(["repo", "features", "--deno-cli"], builtInFeatureRegistry),
    );
    assert(result.includes("Created one commit"));
    assertEquals(
      await gitText(["show", "--format=", "--name-only", "HEAD"], root),
      "deno.jsonc\nsrc/cli/cli.ts\nsrc/cli/command.ts\nsrc/cli/commands.ts\ntest/cli_test.ts",
    );
  });
});

Deno.test("composes Deno CLI and server transitions from one plan snapshot", async () => {
  await withRepository(async (root) => {
    await run(root, "--deno-cli", "--deno-server");
    await smoke(root, "test/cli_test.ts", "test/server_test.ts");
    await deniedServe(root);
    assert(
      (await Deno.readTextFile(new URL("src/cli/commands.ts", root))).includes(
        "serveCommand",
      ),
    );
    await run(root, "--no-deno-server");
    await smoke(root, "test/cli_test.ts");
    assert(
      !(await Deno.readTextFile(new URL("src/cli/commands.ts", root))).includes(
        "serveCommand",
      ),
    );
    await run(root, "--deno-server");
    await run(root, "--no-deno-cli");
    await smoke(root, "test/server_test.ts");
  });
});

Deno.test("composes CLI into an existing server and shared lib directories", async () => {
  await withRepository(async (root) => {
    await run(root, "--deno-server");
    await run(root, "--deno-cli");
    await smoke(root, "test/cli_test.ts", "test/server_test.ts");
    await run(root, "--no-deno-cli", "--no-deno-server");
    await run(root, "--deno-lib", "--deno-cli");
    assert((await Deno.stat(new URL("src/lib/mod.ts", root))).isFile);
    assert((await Deno.stat(new URL("src/cli/cli.ts", root))).isFile);
  });
});

Deno.test("interactive empty selection returns status without changes", async () => {
  await withRepository(async (root) => {
    const result = await runFeatures(
      root,
      parseFeatures(
        ["repo", "features", "--interactive"],
        builtInFeatureRegistry,
      ),
      () => [],
    );
    assertEquals(
      result,
      "deno-cli: disabled\ndeno-fmt: disabled\ndeno-lib: disabled\ndeno-lint: disabled\ndeno-server: disabled\ndeno-test: disabled\ndeno-typecheck: disabled\ngit: disabled\nlicense-mit: disabled\nreadme-build: disabled\nreadme-static: disabled",
    );
  });
});

Deno.test("requires confirmation before preflight or mutation", async () => {
  await withRepository(async (root) => {
    const confirmations: unknown[] = [];
    const registry = confirmationRegistry(confirmations);
    await assertRejects(
      () =>
        runFeatureOperation(
          root,
          parseFeatures(["repo", "features", "--test"], registry),
          registry,
        ),
      Error,
      "confirmation required: Synthetic confirmation warning. Rerun with `--yes`.",
    );
    assertEquals(await fileExists(root, "confirmed.txt"), false);
    await runFeatureOperation(
      root,
      parseFeatures(
        ["repo", "features", "--interactive", "--yes"],
        registry,
      ),
      registry,
      () => ["enable:test"],
    );
    assertEquals(confirmations, [false, true]);
    assertEquals(await fileExists(root, "confirmed.txt"), true);
  });
});

function confirmationRegistry(confirmations: unknown[]): FeatureRegistry {
  return {
    capabilities: [],
    features: [{
      metadata: { id: "test", name: "Test", summary: "Synthetic test." },
      dependencies: { requires: [] },
      capabilities: { provides: [], requires: [] },
      detect: async (context) => ({
        state: await context.files.exists("confirmed.txt")
          ? "enabled"
          : "disabled",
        evidence: [],
      }),
      checkEnable: () =>
        Promise.resolve({
          result: "allowed",
          warnings: [{
            code: "test-warning",
            message: "Synthetic confirmation warning.",
            subjects: [],
            requiresConfirmation: true,
          }],
          preconditions: [],
        }),
      planEnable: (context, allowed) => {
        confirmations.push(context.options.confirmation);
        return Promise.resolve({
          featureId: "test",
          action: "enable",
          summary: "Create confirmation marker.",
          warnings: allowed.warnings,
          preconditions: [],
          changes: [{
            kind: "write-file",
            path: "confirmed.txt",
            content: "confirmed\n",
            expectedDigest: undefined,
          }],
          validations: [{
            kind: "feature-redetection",
            featureId: "test",
            expected: "enabled",
          }],
        });
      },
      checkDisable: () =>
        Promise.resolve({
          result: "allowed",
          warnings: [],
          preconditions: [],
        }),
      planDisable: (_context, allowed) =>
        Promise.resolve({
          featureId: "test",
          action: "disable",
          summary: "No synthetic change.",
          warnings: allowed.warnings,
          preconditions: [],
          changes: [],
          validations: [],
        }),
    }],
  };
}

async function fileExists(root: URL, path: string): Promise<boolean> {
  try {
    await Deno.stat(new URL(path, root));
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

async function withRepository(
  action: (root: URL) => Promise<void>,
): Promise<void> {
  const path = await Deno.makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-cli-features-",
  });
  try {
    await action(new URL(`file://${path}/`));
  } finally {
    await Deno.remove(path, { recursive: true });
  }
}

async function git(args: readonly string[], cwd: URL): Promise<void> {
  const result = await new Deno.Command("git", {
    args: [...args],
    cwd: cwd.pathname,
  }).output();
  if (!result.success) throw new Error(`git failed: ${args[0]}`);
}

async function gitText(args: readonly string[], cwd: URL): Promise<string> {
  const result = await new Deno.Command("git", {
    args: [...args],
    cwd: cwd.pathname,
  }).output();
  if (!result.success) throw new Error(`git failed: ${args[0]}`);
  return new TextDecoder().decode(result.stdout).trim();
}

async function run(root: URL, ...flags: string[]): Promise<string> {
  return await runFeatures(
    root,
    parseFeatures(["repo", "features", ...flags], builtInFeatureRegistry),
  );
}

async function smoke(root: URL, ...paths: string[]): Promise<void> {
  const result = await new Deno.Command("deno", {
    args: ["test", ...paths],
    cwd: root.pathname,
  }).output();
  assert(result.success, new TextDecoder().decode(result.stderr));
}

async function deniedServe(root: URL): Promise<void> {
  const result = await new Deno.Command("deno", {
    args: ["run", "--deny-net", "src/cli/cli.ts", "serve"],
    cwd: root.pathname,
  }).output();
  assert(result.success, new TextDecoder().decode(result.stderr));
  assertEquals(
    new TextDecoder().decode(result.stdout).trim(),
    "Network permission denied.",
  );
}
