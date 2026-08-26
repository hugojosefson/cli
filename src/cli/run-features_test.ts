import { assert, assertEquals } from "@std/assert";
import { builtInFeatureRegistry } from "../features/built-in-feature-registry.ts";
import { parseFeatures } from "./parse-features.ts";
import { runFeatures } from "./run-features.ts";

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
    assertEquals(status, "git: enabled\nreadme-static: disabled");
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

Deno.test("repairs all drift in one Git commit", async () => {
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
    assert(result.includes("Created one commit"));
    assert(
      (await Deno.readTextFile(new URL("README.md", root))).startsWith(
        "# hj-cli-features-",
      ),
    );
    assertEquals(
      (await Deno.stat(new URL("README.md", root))).mode! & 0o777,
      0o644,
    );
    assertEquals(
      await gitText(["show", "--format=", "--name-only", "HEAD"], root),
      "README.md",
    );
  });
});

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
