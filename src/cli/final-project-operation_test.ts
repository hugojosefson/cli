import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { denoFmtFeature } from "../features/deno-fmt-feature.ts";
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

Deno.test("operation runs final task before content commits and commits the validated task output", async () => {
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

Deno.test("operation returns task failure without content commits and preserves task edits", async () => {
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
      await Deno.readTextFile(new URL("README.md", root)),
      "# Fix this\n",
    );
    assertEquals(await git(root, "status", "--porcelain"), "?? README.md");
  });
});

Deno.test("unattributed task edits remain visible and prevent content commits", async () => {
  await fixture(async (root) => {
    await seed(
      root,
      `Deno.writeTextFileSync("unrelated.txt", "unexpected\\n");`,
    );
    const before = await git(root, "rev-parse", "HEAD");
    await assertRejects(() => run(root, "--readme-static"));
    assertEquals(await git(root, "rev-parse", "HEAD"), before);
    assertEquals(
      await Deno.readTextFile(new URL("unrelated.txt", root)),
      "unexpected\n",
    );
    assertStringIncludes(
      await git(root, "status", "--porcelain"),
      "?? README.md",
    );
  });
});

Deno.test("CLI exits with the final task's original failure code", async () => {
  await fixture(async (root) => {
    await seed(root, "Deno.exit(17);");
    const result = await new Deno.Command("deno", {
      args: [
        "run",
        "--frozen",
        "--allow-all",
        "--config",
        new URL("../../deno.json", import.meta.url).pathname,
        new URL("./cli.ts", import.meta.url).href,
        "repo",
        "features",
        "--readme-static",
      ],
      cwd: root,
    }).output();
    assertEquals(result.code, 17, new TextDecoder().decode(result.stderr));
    assertStringIncludes(
      new TextDecoder().decode(result.stderr),
      "deno task default failed (exit 17)",
    );
    assertEquals(await git(root, "rev-list", "--count", "HEAD"), "1");
  });
});

Deno.test("removing the feature that supplied default reports its absence", async () => {
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
    await assertRejects(
      () => Deno.stat(new URL("deno.jsonc", root)),
      Deno.errors.NotFound,
    );
    assertEquals(await git(root, "status", "--porcelain"), "");
  });
});

Deno.test("status inspection never starts an existing failing default task", async () => {
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
  await Deno.writeTextFile(new URL("task.ts", root), code);
  await Deno.writeTextFile(
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
  const path = await Deno.makeTempDir({
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
    await Deno.remove(root, { recursive: true });
  }
}

async function git(root: URL, ...args: string[]) {
  const result = await new Deno.Command("git", { args, cwd: root }).output();
  assert(result.success, new TextDecoder().decode(result.stderr));
  return new TextDecoder().decode(result.stdout).trim();
}
