import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { PromptCancelled } from "./prompt-cancelled.ts";
import { LocalGithubClient } from "../repository/local-github-client.ts";
import type { FeatureRegistry } from "../features/feature-registry.ts";
import { builtInFeatureRegistry } from "../features/built-in-feature-registry.ts";
import { denoFmtFeature } from "../features/deno-fmt-feature.ts";
import { licenseCatalog } from "../features/license-catalog.ts";
import { createSpdxLicenseFeature } from "../features/license-spdx-feature.ts";
import { readmeBuildFeature } from "../features/readme-build-feature.ts";
import { readmeStaticFeature } from "../features/readme-static-feature.ts";
import { buildReadme } from "../readme/build-readme.ts";
import { parseFeatures } from "./parse-features.ts";
import {
  runFeatureOperation as actualRunFeatureOperation,
  type runFeatures as actualRunFeatures,
} from "./run-features.ts";

// These tests exercise plans and commits; task subprocesses have dedicated tests.
function runFeatureOperation(
  ...args: Parameters<typeof actualRunFeatureOperation>
) {
  return actualRunFeatureOperation(args[0], args[1], args[2], args[3], {
    ...args[4],
    runFinalTask: () => Promise.resolve(undefined),
  });
}
function runFeatures(...args: Parameters<typeof actualRunFeatures>) {
  return runFeatureOperation(
    args[0],
    args[1],
    builtInFeatureRegistry,
    args[2],
    { colors: args[3] },
  );
}

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
      status.split("\n").slice(2).filter((line) => /^\S/.test(line)).map((
        line,
      ) => line.trim().split(/ +/).slice(0, 2).join(": ")).join("\n"),
      featureStatus("enabled"),
    );
    const enabled = await runFeatures(
      root,
      parseFeatures(["repo", "features", "--readme"], builtInFeatureRegistry),
    );
    assert(enabled.includes("Committed each changed feature"));
    assertEquals(
      await gitText(["log", "--format=%s", "-1"], root),
      "chore(readme-static): enable feature",
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
    assert(disabled.includes("Committed each changed feature"));
    assertEquals(await gitText(["rev-list", "--count", "HEAD"], root), "3");
    assertEquals(
      await gitText(["show", "--format=", "--name-only", "HEAD"], root),
      "README.md",
    );
    assertEquals((await Deno.stat(new URL("keep.txt", root))).isFile, true);
  });
});

Deno.test("reports local changes without Git and reports a repeat as unchanged", async () => {
  await withRepository(async (root) => {
    const first = await run(root, "--deno-fmt");
    assertStringIncludes(first, "Applied local changes.");
    assert(!first.includes("No changes."));
    assertEquals(await fileExists(root, "deno.jsonc"), true);
    assertEquals(await fileExists(root, ".git"), false);
    const repeated = await run(root, "--deno-fmt");
    assertStringIncludes(repeated, "No changes.");
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
    assert(!result.includes("Committed each changed feature"));
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
    assert(result.includes("Committed each changed feature"));
    assertEquals(
      await gitText(["show", "--format=", "--name-only", "HEAD"], root),
      ".hj/deno-lock.json\ndeno.jsonc",
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
    assert(result.includes("Committed each changed feature"));
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
    assert(result.includes("Committed each changed feature"));
    assertEquals(
      await gitText(["show", "--format=", "--name-only", "HEAD"], root),
      ".hj/deno-lock.json\ndeno.jsonc\ndeno.lock\nsrc/cli/cli.ts\nsrc/cli/command.ts\nsrc/cli/commands.ts\nsrc/cli/package-metadata.json\ntest/cli_test.ts",
    );
  });
});

Deno.test("composes Deno CLI and server transitions from one plan snapshot", async () => {
  await withRepository(async (root) => {
    await run(root, "--deno-cli", "--deno-server");
    await smoke(root, "test/cli_test.ts", "test/server_test.ts");
    await deniedServe(root);
    assert(
      (await Deno.readTextFile(
        new URL("src/cli/commands.ts", root),
      )).includes(
        "serveCommand",
      ),
    );
    await run(root, "--no-deno-server");
    await smoke(root, "test/cli_test.ts");
    assert(
      !(await Deno.readTextFile(
        new URL("src/cli/commands.ts", root),
      )).includes(
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
      result.split("\n").slice(2).filter((line) => /^\S/.test(line)).map((
        line,
      ) => line.trim().split(/ +/).slice(0, 2).join(": ")).join("\n"),
      featureStatus("disabled"),
    );
  });
});

Deno.test("MPL and Unlicense do not resolve attribution", async () => {
  for (const id of ["license-mpl-2.0", "license-unlicense"]) {
    await withRepository(async (root) => {
      const provider = licenseCatalog.find((item) => item.id === id)!;
      const registry: FeatureRegistry = {
        capabilities: [{
          id: "license",
          providerPolicy: "exclusive",
          defaultProvider: id,
        }, {
          id: "readme",
          providerPolicy: "exclusive",
          defaultProvider: "readme-static",
        }],
        features: [
          readmeStaticFeature,
          createSpdxLicenseFeature({
            ...provider,
            text: () => Promise.resolve("tiny\n"),
            alternates: [],
          }),
        ],
      };
      let prompts = 0;
      await runFeatureOperation(
        root,
        parseFeatures(["repo", "features", `--${id}`], registry),
        registry,
        () => [],
        {
          promptAttribution: () => {
            prompts++;
            return "Ada";
          },
        },
      );
      assertEquals(prompts, 0);
    });
  }
});

Deno.test("owns the static README license section and blocks custom content", async () => {
  await withRepository(async (root) => {
    const mit = licenseCatalog.find((provider) =>
      provider.id === "license-mit"
    )!;
    const registry: FeatureRegistry = {
      capabilities: [{
        id: "license",
        providerPolicy: "exclusive",
        defaultProvider: "license-mit",
      }, {
        id: "readme",
        providerPolicy: "exclusive",
        defaultProvider: "readme-static",
      }],
      features: [
        readmeStaticFeature,
        createSpdxLicenseFeature({
          ...mit,
          text: () => Promise.resolve("MIT <year> <copyright holders>\n"),
          alternates: [],
        }),
      ],
    };
    const services = {
      githubIdentity: { viewer: () => Promise.resolve({ name: "Ada" }) },
    };
    await runFeatureOperation(
      root,
      parseFeatures(["repo", "features", "--license-mit"], registry),
      registry,
      () => [],
      services,
    );
    assertStringIncludes(
      await read(root, "README.md"),
      "## License\n\n[MIT](./LICENSE)\n",
    );
    const custom = (await read(root, "README.md")).replace(
      "[MIT](./LICENSE)",
      "Custom terms apply.",
    );
    await Deno.writeTextFile(new URL("README.md", root), custom);
    const license = await read(root, "LICENSE");
    await assertRejects(() =>
      runFeatureOperation(
        root,
        parseFeatures(["repo", "features", "--no-license-mit"], registry),
        registry,
      )
    );
    assertEquals(await read(root, "README.md"), custom);
    assertEquals(await read(root, "LICENSE"), license);
  });
});

Deno.test("replaces an injected MIT license in a generated README without partial changes", async () => {
  await withRepository(async (root) => {
    const registry = generatedLicenseRegistry();
    const services = {
      githubIdentity: { viewer: () => Promise.resolve({ name: "Ada" }) },
    };
    await runFeatureOperation(
      root,
      parseFeatures(
        ["repo", "features", "--readme-build", "--license-mit"],
        registry,
      ),
      registry,
      () => [],
      services,
    );
    assertEquals(await read(root, "LICENSE"), "MIT 2026 Ada\n");
    assertStringIncludes(
      await read(root, "readme/README.md"),
      "[MIT](../LICENSE)",
    );
    assertStringIncludes(await read(root, "README.md"), "[MIT](./LICENSE)");

    await runFeatureOperation(
      root,
      parseFeatures(["repo", "features", "--license-apache-2.0"], registry),
      registry,
      () => [],
      services,
    );
    assertEquals(await read(root, "LICENSE"), "Apache 2026 Ada\n");
    assertStringIncludes(
      await read(root, "readme/README.md"),
      "[Apache-2.0](../LICENSE)",
    );
    assertStringIncludes(
      await read(root, "README.md"),
      "[Apache-2.0](./LICENSE)",
    );
    assertEquals(
      (await Deno.stat(new URL("README.md", root))).mode! & 0o777,
      0o444,
    );
    assertEquals(await buildReadme(root), await read(root, "README.md"));

    await Deno.chmod(new URL("README.md", root), 0o644);
    await runFeatureOperation(
      root,
      parseFeatures(["repo", "features", "--repair"], registry),
      registry,
    );
    assertEquals(
      (await Deno.stat(new URL("README.md", root))).mode! & 0o777,
      0o444,
    );

    const source = await read(root, "readme/README.md");
    await Deno.writeTextFile(
      new URL("readme/README.md", root),
      source.replace("## License\n\n[Apache-2.0](../LICENSE)\n", ""),
    );
    await runFeatureOperation(
      root,
      parseFeatures(["repo", "features", "--repair"], registry),
      registry,
    );
    assertStringIncludes(
      await read(root, "readme/README.md"),
      "## License\n\n[Apache-2.0](../LICENSE)\n",
    );
    assertEquals(await buildReadme(root), await read(root, "README.md"));

    await Deno.chmod(new URL("readme/README.md", root), 0o444);
    await runFeatureOperation(
      root,
      parseFeatures(
        ["repo", "features", "--repair", "--license-apache-2.0"],
        registry,
      ),
      registry,
    );
    assertEquals(
      (await Deno.stat(new URL("readme/README.md", root))).mode! & 0o777,
      0o644,
    );

    await Deno.remove(new URL("README.md", root));
    await runFeatureOperation(
      root,
      parseFeatures(
        ["repo", "features", "--repair", "--license-apache-2.0"],
        registry,
      ),
      registry,
    );
    assertEquals(await buildReadme(root), await read(root, "README.md"));
    assertEquals(
      (await Deno.stat(new URL("README.md", root))).mode! & 0o777,
      0o444,
    );

    await runFeatureOperation(
      root,
      parseFeatures(["repo", "features", "--no-license-apache-2.0"], registry),
      registry,
    );
    assertEquals(await fileExists(root, "LICENSE"), false);
    assert(!((await read(root, "readme/README.md")).includes("## License")));
    assert(!((await read(root, "README.md")).includes("## License")));
    assertEquals(await buildReadme(root), await read(root, "README.md"));
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

Deno.test("validation failures report the expected and observed feature state", async () => {
  await withRepository(async (root) => {
    const base = confirmationRegistry([]);
    const feature = base.features[0];
    const registry: FeatureRegistry = {
      ...base,
      features: [{
        ...feature,
        detect: () =>
          Promise.resolve({
            state: "disabled",
            evidence: [{
              code: "not-retained",
              kind: "test",
              subject: { kind: "file", identifier: "confirmed.txt" },
              observation: "The setting was not retained.",
            }],
          }),
      }],
    };
    const error = await assertRejects(() =>
      runFeatureOperation(
        root,
        parseFeatures(["repo", "features", "--test", "--yes"], registry),
        registry,
      ), Error);
    const message = error.message.replace(/ +/g, " ");
    assertStringIncludes(message, "Feature validation failed.");
    assertStringIncludes(
      message,
      "test enabled disabled The setting was not retained.",
    );
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

function generatedLicenseRegistry(): FeatureRegistry {
  const mit = licenseCatalog.find((provider) => provider.id === "license-mit")!;
  const apache = licenseCatalog.find((provider) =>
    provider.id === "license-apache-2.0"
  )!;
  const mitText = () => Promise.resolve("MIT <year> <copyright holders>\n");
  const apacheText = () =>
    Promise.resolve("Apache [yyyy] [name of copyright owner]\n");
  return {
    capabilities: [{
      id: "license",
      providerPolicy: "exclusive",
      defaultProvider: "license-mit",
    }, {
      id: "readme",
      providerPolicy: "exclusive",
      defaultProvider: "readme-build",
    }],
    features: [
      denoFmtFeature,
      readmeBuildFeature,
      createSpdxLicenseFeature({
        ...mit,
        text: mitText,
        alternates: [{ ...apache, text: apacheText }],
      }),
      createSpdxLicenseFeature({
        ...apache,
        text: apacheText,
        alternates: [{ ...mit, text: mitText }],
      }),
    ],
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

function read(root: URL, path: string): Promise<string> {
  return Deno.readTextFile(new URL(path, root));
}

function featureStatus(git: string): string {
  return builtInFeatureRegistry.features.map((feature) => feature.metadata.id)
    .sort().map((id) => `${id}: ${id === "git" ? git : "disabled"}`).join("\n");
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

Deno.test("interactive cancellation preserves its exit meaning and never applies saved defaults", async () => {
  await withRepository(async (root) => {
    class DiagnosticGithub extends LocalGithubClient {
      override get diagnostics(): readonly string[] {
        return ["GitHub inspection unavailable."];
      }
    }
    const github = new DiagnosticGithub(root);
    await assertRejects(
      () =>
        runFeatureOperation(
          root,
          {
            kind: "interactive",
            confirmation: false,
            configuredDefaults: [{ kind: "feature", featureId: "deno-fmt" }],
          },
          builtInFeatureRegistry,
          () => Promise.reject(new PromptCancelled()),
          { github },
        ),
      PromptCancelled,
    );
    assertEquals(await fileExists(root, "deno.jsonc"), false);
    assertEquals(await fileExists(root, ".git"), false);
  });
});
