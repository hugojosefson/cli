import {
  evalArgumentsCode,
  executableModule,
  runModuleEval,
} from "../testing/runtime-test-fixtures.ts";
import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import {
  fixtureReadDir,
  makeTempDir,
  mkdir,
  remove,
  writeTextFile,
} from "../testing/files-test-fixtures.ts";
import { runRawCommand as runCommand } from "../runtime/command.ts";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";

const operationUrl =
  executableModule("./run-features.ts", import.meta.url).href;
const parserUrl = executableModule("./parse-features.ts", import.meta.url).href;
const registryUrl =
  executableModule("../features/built-in-feature-registry.ts", import.meta.url)
    .href;
const licenseUrl =
  executableModule("../features/license-spdx-feature.ts", import.meta.url).href;
const catalogUrl =
  executableModule("../features/license-catalog.ts", import.meta.url).href;
const featureFlags = [
  "--readme-static",
  "--license-mit",
  "--git",
  "--deno-server",
  "--deno-cli",
];

test("fresh feature setup commits only generated paths and is safe to repeat", async () => {
  await withDirectory(async (root, env) => {
    await writeTextFile(new URL("keep.txt", root), "unrelated\n");
    const first = await run(root, env, featureFlags);
    assert(first.success, text(first.stderr));
    assertStringIncludes(
      text(first.stdout),
      "Initialized Git with an empty base; committed changed features.",
    );
    assertEquals(await git(root, "rev-list", "--count", "HEAD"), "6");
    assertEquals(
      await git(root, "log", "--reverse", "--format=%s"),
      [
        "chore: init repo",
        "chore(deno-fmt): enable feature",
        "chore(deno-cli): enable feature",
        "chore(deno-server): enable feature",
        "chore(readme-static): enable feature",
        "chore(license-mit): enable feature",
      ].join("\n"),
    );
    assertEquals(
      await git(root, "ls-tree", "-r", "--name-only", "HEAD"),
      [
        ".hj/deno-lock.json",
        "LICENSE",
        "README.md",
        "deno.jsonc",
        "deno.lock",
        "src/cli/cli.ts",
        "src/cli/command.ts",
        "src/cli/commands.ts",
        "src/cli/package-metadata.json",
        "src/cli/serve-command.ts",
        "src/server/server.ts",
        "test/cli_test.ts",
        "test/server_test.ts",
      ].join("\n"),
    );
    assert(
      !(await git(root, "show", "HEAD~1:README.md")).includes("## License"),
    );
    assert((await git(root, "show", "HEAD:README.md")).includes("## License"));
    assertEquals(await git(root, "status", "--porcelain"), "?? keep.txt");
    const again = await run(root, env, featureFlags);
    assert(again.success, text(again.stderr));
    assertStringIncludes(text(again.stdout), "No changes.");
    assertEquals(await git(root, "rev-list", "--count", "HEAD"), "6");
  });
});

test("generated README license content belongs to the license commit", async () => {
  await withDirectory(async (root, env) => {
    const result = await run(root, env, [
      "--readme-build",
      "--license-mit",
      "--git",
    ]);
    assert(result.success, text(result.stderr));
    assertEquals(
      await git(root, "log", "-1", "--format=%s"),
      "chore(license-mit): enable feature",
    );
    for (const path of ["README.md", "readme/README.md"]) {
      assert(
        !(await git(root, "show", `HEAD~1:${path}`)).includes("## License"),
      );
      assert((await git(root, "show", `HEAD:${path}`)).includes("## License"));
    }
    assertEquals(await git(root, "status", "--porcelain"), "");
  });
});

test("package README sections belong to the CLI, library, and JSR commits", async () => {
  await withDirectory(async (root, env) => {
    const result = await run(root, env, [
      "--readme-static",
      "--license-mit",
      "--git",
      "--deno-cli",
      "--deno-lib",
      "--jsr-package",
      "--jsr-scope=example",
    ]);
    assert(result.success, text(result.stderr));
    const history = (await git(root, "log", "--reverse", "--format=%H %s"))
      .split("\n");
    for (
      const [owner, marker] of [
        ["deno-cli", "deno-cli:installation"],
        ["deno-lib", "deno-lib:example"],
        ["deno-lib", "deno-lib:api"],
        ["jsr-package", "jsr-package:badges"],
      ]
    ) {
      const commit = history.find((line) =>
        line.includes(`chore(${owner}):`)
      )!.split(" ")[0];
      const before = (await git(root, "ls-tree", `${commit}^`, "README.md"))
        ? await git(root, "show", `${commit}^:README.md`)
        : "";
      assertEquals(before.includes(marker), false, `${owner}: ${before}`);
      assertStringIncludes(
        await git(root, "show", `${commit}:README.md`),
        marker,
      );
    }
    assertEquals(await git(root, "status", "--porcelain"), "");
    const again = await run(root, env, [
      "--readme-static",
      "--license-mit",
      "--git",
      "--deno-cli",
      "--deno-lib",
      "--jsr-package",
      "--jsr-scope=example",
    ]);
    assert(again.success, text(again.stderr));
    assertStringIncludes(text(again.stdout), "No changes.");
  });
});

test("Git alone creates one empty initial commit", async () => {
  await withDirectory(async (root, env) => {
    const result = await run(root, env, ["--git"]);
    assert(result.success, text(result.stderr));
    assertEquals(
      await git(root, "log", "-1", "--format=%s"),
      "chore: init repo",
    );
    assertEquals(await git(root, "ls-tree", "-r", "--name-only", "HEAD"), "");
    assertEquals(await git(root, "rev-list", "--count", "HEAD"), "1");
  });
});

for (const role of ["AUTHOR", "COMMITTER"]) {
  test(`missing Git ${role.toLowerCase()} identity stops before initialization or file changes`, async () => {
    await withDirectory(async (root, env) => {
      const result = await run(root, {
        ...env,
        [`GIT_${role}_NAME`]: "",
        [`GIT_${role}_EMAIL`]: "",
      }, featureFlags);
      assertEquals(result.success, false);
      assertStringIncludes(
        text(result.stderr),
        `Git ${role.toLowerCase()} identity is required.`,
      );
      assertStringIncludes(
        text(result.stderr),
        "git config --global user.name",
      );
      assertStringIncludes(
        text(result.stderr),
        "git config --global user.email",
      );
      assertStringIncludes(text(result.stderr), "No changes were made.");
      const entries = [];
      for await (const entry of fixtureReadDir(root)) entries.push(entry.name);
      assertEquals(entries, []);
    });
  });
}

async function withDirectory(
  action: (root: URL, env: Record<string, string>) => Promise<void>,
) {
  const directory = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-first-commit-",
  });
  const root = new URL(`file://${directory}/project/`);
  try {
    await mkdir(root);
    const configPath = `${directory}/gitconfig`;
    await writeTextFile(
      configPath,
      "[user]\n  name = Test User\n  email = test@example.invalid\n",
    );
    await action(root, {
      GIT_CONFIG_GLOBAL: configPath,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_COUNT: "0",
      GIT_AUTHOR_NAME: "Test User",
      GIT_AUTHOR_EMAIL: "test@example.invalid",
      GIT_COMMITTER_NAME: "Test User",
      GIT_COMMITTER_EMAIL: "test@example.invalid",
    });
  } finally {
    await remove(directory, { recursive: true });
  }
}

function run(root: URL, env: Record<string, string>, flags: string[]) {
  // Use the actual feature set with offline license text and no GitHub lookup.
  // A child process isolates Git identity configuration from other tests.
  const code = `
    ${evalArgumentsCode}
    import { runFeatureOperation } from ${JSON.stringify(operationUrl)};
    import { parseFeatures } from ${JSON.stringify(parserUrl)};
    import { builtInFeatureRegistry } from ${JSON.stringify(registryUrl)};
    import { createSpdxLicenseFeature } from ${JSON.stringify(licenseUrl)};
    import { licenseCatalog } from ${JSON.stringify(catalogUrl)};
    const mit = licenseCatalog.find((item) => item.id === "license-mit");
    const registry = {
      ...builtInFeatureRegistry,
      features: builtInFeatureRegistry.features.map((feature) =>
        feature.metadata.id === "license-mit"
          ? createSpdxLicenseFeature({ ...mit, text: () => Promise.resolve("MIT <year> <copyright holders>\\n"), alternates: [] })
          : feature),
    };
    console.log(await runFeatureOperation(
      new URL(args[0]),
      parseFeatures(["repo", "features", ...args.slice(1)], registry),
      registry,
      () => [],
      { githubIdentity: { viewer: async () => undefined }, runFinalTask: async () => undefined,
        jsrScopes: { scopes: async () => ({kind: "missing-authentication"}) } },
    ));
  `;
  return runModuleEval(code, [root.href, ...flags], { env });
}

async function git(root: URL, ...args: string[]) {
  const result = await runCommand("git", { args, cwd: root });
  assert(result.success, text(result.stderr));
  return text(result.stdout).trim();
}

function text(bytes: Uint8Array) {
  return new TextDecoder().decode(bytes);
}
