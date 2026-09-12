import { assert, assertEquals, assertStringIncludes } from "@std/assert";

const operationUrl = new URL("./run-features.ts", import.meta.url).href;
const parserUrl = new URL("./parse-features.ts", import.meta.url).href;
const registryUrl =
  new URL("../features/built-in-feature-registry.ts", import.meta.url).href;
const licenseUrl =
  new URL("../features/license-spdx-feature.ts", import.meta.url).href;
const catalogUrl =
  new URL("../features/license-catalog.ts", import.meta.url).href;
const featureFlags = [
  "--readme-static",
  "--license-mit",
  "--git",
  "--deno-server",
  "--deno-cli",
];

Deno.test("fresh feature setup commits only generated paths and is safe to repeat", async () => {
  await withDirectory(async (root, env) => {
    await Deno.writeTextFile(new URL("keep.txt", root), "unrelated\n");
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

Deno.test("generated README license content belongs to the license commit", async () => {
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

Deno.test("package README sections belong to the CLI, library, and JSR commits", async () => {
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
      assertEquals(before.includes(marker), false);
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

Deno.test("Git alone creates one empty initial commit", async () => {
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
  Deno.test(`missing Git ${role.toLowerCase()} identity stops before initialization or file changes`, async () => {
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
      for await (const entry of Deno.readDir(root)) entries.push(entry.name);
      assertEquals(entries, []);
    });
  });
}

async function withDirectory(
  action: (root: URL, env: Record<string, string>) => Promise<void>,
) {
  const directory = await Deno.makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-first-commit-",
  });
  const root = new URL(`file://${directory}/project/`);
  try {
    await Deno.mkdir(root);
    const configPath = `${directory}/gitconfig`;
    await Deno.writeTextFile(
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
    await Deno.remove(directory, { recursive: true });
  }
}

function run(root: URL, env: Record<string, string>, flags: string[]) {
  // Use the actual feature set with offline license text and no GitHub lookup.
  // A child process isolates Git identity configuration from other tests.
  const code = `
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
      new URL(Deno.args[0]),
      parseFeatures(["repo", "features", ...Deno.args.slice(1)], registry),
      registry,
      () => [],
      { githubIdentity: { viewer: async () => undefined }, runFinalTask: async () => undefined,
        jsrScopes: { scopes: async () => ({kind: "missing-authentication"}) } },
    ));
  `;
  return new Deno.Command("deno", {
    args: ["eval", "--frozen", code, root.href, ...flags],
    env,
  }).output();
}

async function git(root: URL, ...args: string[]) {
  const result = await new Deno.Command("git", { args, cwd: root }).output();
  assert(result.success, text(result.stderr));
  return text(result.stdout).trim();
}

function text(bytes: Uint8Array) {
  return new TextDecoder().decode(bytes);
}
