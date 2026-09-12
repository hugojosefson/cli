import { sourceFile } from "../testing/runtime-test-fixtures.ts";
import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import {
  fixtureStat,
  mkdir,
  readTextFile,
  remove,
  rename,
  writeTextFile,
} from "../testing/files-test-fixtures.ts";
import { runCommand } from "../runtime/command.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { runCli as executeCli } from "../cli/run-cli.ts";
import { runFeatureOperation } from "../cli/run-features.ts";
import { parseFeatures } from "../cli/parse-features.ts";
import { builtInFeatureRegistry } from "../features/built-in-feature-registry.ts";
import { applyLocalChangePlan } from "../operations/local-change-plan.ts";
import { denoCliFeature } from "../features/deno-cli-feature.ts";
import {
  context,
  withRepository,
  writeConfig,
} from "../features/jsr-package-test-fixtures.ts";
import { denoTaskDefinitions } from "../features/deno-tasks.ts";
import { packageMetadataTask } from "../features/deno-cli-artifacts.ts";
import { hjPackageReference } from "../features/hj-package.ts";

test("configured rename rebuilds CLI help and retained README references from JSON and JSONC", async () => {
  for (const filename of ["deno.json", "deno.jsonc"]) {
    await withRepository(async (root) => {
      const config = {
        tasks: denoTaskDefinitions([], true),
        name: "@acme/original-tool",
        exports: { ".": "./mod.ts" },
      };
      await writeConfig(root, config);
      if (filename === "deno.jsonc") {
        await rename(new URL("deno.json", root), new URL(filename, root));
      }
      const current = { ...context(root), resolvedChanges: [] };
      const check = await denoCliFeature.checkEnable(current);
      if (check.result !== "allowed") throw new Error(JSON.stringify(check));
      await applyLocalChangePlan(
        root,
        await denoCliFeature.planEnable(current, check),
      );
      const source =
        "# {{package.name}}\n\n[![JSR]({{package.badge}})]({{package.url}})\n\n[API]({{package.api}})\n\n```sh\n{{package.install}}\n{{package.run}} help\n```\n\nCustom @acme/original-tool stays.\n";
      await mkdir(new URL("readme", root));
      await writeTextFile(new URL("readme/README.md", root), source);
      await writeTextFile(
        new URL("example.ts", root),
        'import { example } from "./mod.ts";\n',
      );
      await writeTextFile(
        new URL("mod.ts", root),
        "export const example = 1;\n",
      );
      // Both checkout and installed executions run with another project's cwd.
      const caller = new URL("caller/", root);
      await mkdir(caller);
      await writeTextFile(
        new URL("deno.json", caller),
        '{"name":"@wrong/caller"}',
      );
      const executable = new URL("src/cli/cli.ts", root);
      const before = await runCommand("deno", {
        args: ["run", executable.href, "help"],
        cwd: caller,
      });
      assert(before.success, new TextDecoder().decode(before.stderr));
      assertStringIncludes(
        new TextDecoder().decode(before.stdout),
        "Usage: original-tool",
      );
      const path = new URL(filename, root);
      await writeTextFile(
        path,
        (await readTextFile(path)).replace(
          "@acme/original-tool",
          "@other/renamed-tool",
        ),
      );
      // Run the contributed build task against this checkout's CLI, without a registry release.
      const cli = sourceFile("src/cli/cli.ts").href;
      const text = await readTextFile(path);
      await writeTextFile(path, text.replaceAll(hjPackageReference, cli));
      const rebuild = await runCommand("deno", {
        args: ["task", "default"],
        cwd: root,
      });
      assert(rebuild.success, new TextDecoder().decode(rebuild.stderr));
      const after = await runCommand("deno", {
        args: ["run", executable.href, "help"],
        cwd: caller,
      });
      assert(after.success, new TextDecoder().decode(after.stderr));
      assertStringIncludes(
        new TextDecoder().decode(after.stdout),
        "@other/renamed-tool\n\nUsage: renamed-tool",
      );
      const readme = (await runCli(root, ["readme", "build"])).output;
      for (
        const expected of [
          "# @other/renamed-tool",
          "https://jsr.io/badges/@other/renamed-tool",
          "https://jsr.io/@other/renamed-tool/doc",
          "--name renamed-tool jsr:@other/renamed-tool/cli",
          "deno run jsr:@other/renamed-tool/cli help",
          "Custom @acme/original-tool stays.",
        ]
      ) assertStringIncludes(readme, expected);
      assertStringIncludes(
        await readTextFile(new URL("readme/README.md", root)),
        "{{package.name}}",
      );
      assertEquals(await readTextFile(new URL("README.md", root)), readme);
      await writeTextFile(
        new URL("readme/README.md", root),
        source + "\n```ts\n@@include(../example.ts)\n```\n",
      );
      assertStringIncludes(
        (await runCli(root, ["readme", "build"])).output,
        'from "@other/renamed-tool"',
      );
      const installation = new URL("installed/", root);
      const install = await runCommand("deno", {
        args: [
          "install",
          "--global",
          "--root",
          installation.pathname,
          "--name",
          "renamed-tool",
          executable.href,
        ],
        cwd: caller,
      });
      assert(install.success, new TextDecoder().decode(install.stderr));
      const installed = await runCommand("sh", {
        args: [new URL("bin/renamed-tool", installation).pathname, "help"],
        cwd: caller,
      });
      assert(installed.success, new TextDecoder().decode(installed.stderr));
      assertStringIncludes(
        new TextDecoder().decode(installed.stdout),
        "Usage: renamed-tool",
      );
      assertStringIncludes(packageMetadataTask.command, "package build");
      await writeTextFile(
        new URL("readme/README.md", root),
        "{{package.unknown}}",
      );
      await assertRejects(
        () => runCli(root, ["readme", "build"]),
        Error,
        "Unknown package reference",
      );
      await assertRejects(
        () => runCli(root, ["package", "build", "extra"]),
        Error,
        "expected",
      );
    });
  }
});

test("generated README keeps configured name references and custom prose", async () => {
  await withRepository(async (root) => {
    await writeConfig(root, { name: "@acme/deno-original" });
    await runCli(root, ["repo", "features", "--readme-build"]);
    const source = new URL("readme/README.md", root);
    assertStringIncludes(
      await readTextFile(source),
      "# {{package.name}}\n",
    );
    const originalOutput = await readTextFile(new URL("README.md", root));
    assertStringIncludes(originalOutput, "# @acme/deno-original\n");
    assertStringIncludes(originalOutput, "Requires [Deno](https://deno.com/).");
    await writeTextFile(
      source,
      (await readTextFile(source)) + "\nCustom prose.\n",
    );
    const path = new URL("deno.json", root);
    await writeTextFile(
      path,
      (await readTextFile(path)).replace(
        "@acme/deno-original",
        "@acme/other-tool",
      ),
    );
    assertEquals(
      (await runCli(root, ["readme", "build"])).output,
      originalOutput.replace("@acme/deno-original", "@acme/other-tool") +
        "\nCustom prose.\n",
    );
    await writeTextFile(source, "{{package.constructor}}");
    await assertRejects(
      () => runCli(root, ["readme", "build"]),
      Error,
      "Unknown package reference",
    );
    await writeConfig(root, { exports: "./mod.ts" });
    await writeTextFile(source, "{{package.install}}");
    await assertRejects(
      () => runCli(root, ["readme", "build"]),
      Error,
      "scoped JSR name",
    );
    await writeTextFile(source, "@@include(../example.ts)");
    await writeTextFile(
      new URL("example.ts", root),
      'import {} from "./mod.ts";',
    );
    assertEquals(
      (await runCli(root, ["readme", "build"])).output,
      'import {} from "./mod.ts";',
    );
  });
});

test("CLI metadata composes with formatter tasks in an existing empty config", async () => {
  await withRepository(async (root) => {
    await writeConfig(root, {});
    await runCli(root, [
      "repo",
      "features",
      "--deno-cli",
      "--deno-test",
      "--deno-server",
    ]);
    const config = JSON.parse(
      await readTextFile(new URL("deno.json", root)),
    );
    assertEquals(config.tasks["package-metadata"], packageMetadataTask);
    const output = await runCommand("deno", {
      args: ["run", new URL("src/cli/cli.ts", root).href, "help"],
    });
    assert(output.success, new TextDecoder().decode(output.stderr));
  });
});

test("CLI disable removes only its owned metadata task and retains installed source", async () => {
  for (const custom of [false, true]) {
    await withRepository(async (root) => {
      await writeConfig(root, { name: "@scope/tool" });
      await runCli(root, ["repo", "features", "--deno-cli"]);
      const path = new URL("deno.json", root);
      if (custom) {
        const config = JSON.parse(await readTextFile(path));
        config.tasks["package-metadata"] = "custom command";
        await writeTextFile(path, JSON.stringify(config));
      }
      await runCli(root, ["repo", "features", "--no-deno-cli"]);
      const config = JSON.parse(await readTextFile(path));
      assertEquals(
        config.tasks["package-metadata"],
        custom ? "custom command" : undefined,
      );
      assert(
        (await fixtureStat(new URL("src/cli/package-metadata.json", root)))
          .isFile,
      );
    });
  }
});

test("initial CLI metadata uses the planned JSR identity before configuration is written", async () => {
  await withRepository(async (root) => {
    const current = context(root, undefined, ["deno-fmt", "deno-cli"]);
    const { inspectDenoCliArtifacts } = await import(
      "../features/deno-cli-artifacts.ts"
    );
    const { initialDenoConfig } = await import(
      "../features/deno-initial-config.ts"
    );
    const artifacts = await inspectDenoCliArtifacts(current);
    const metadata = artifacts.find((item) =>
      item.schema.path === "src/cli/package-metadata.json"
    )!.schema;
    if (metadata.kind !== "file") {
      throw new Error("Expected metadata file");
    }
    const config = await initialDenoConfig(current, {}, "deno-fmt");
    assertEquals(JSON.parse(metadata.content).name, config.name);
    assertStringIncludes(String(config.name), "@owner/");
  });
});

test("server repair includes metadata required by an older CLI registry", async () => {
  await withRepository(async (root) => {
    await writeConfig(root, { name: "@scope/tool" });
    await runCli(root, ["repo", "features", "--deno-cli", "--deno-server"]);
    await remove(new URL("src/cli/package-metadata.json", root));
    const path = new URL("deno.json", root);
    const config = JSON.parse(await readTextFile(path));
    delete config.tasks["package-metadata"];
    await writeTextFile(path, JSON.stringify(config));
    await runCli(root, ["repo", "features", "--deno-server", "--repair"]);
    const output = await runCommand("deno", {
      args: ["run", new URL("src/cli/cli.ts", root).href, "help"],
    });
    assert(output.success, new TextDecoder().decode(output.stderr));
    assertStringIncludes(
      new TextDecoder().decode(output.stdout),
      "Usage: tool",
    );
    assertEquals(
      JSON.parse(await readTextFile(path)).tasks["package-metadata"],
      packageMetadataTask,
    );
  });
});

// Run generated commands explicitly in each test without fetching hj at setup.
function runCli(root: URL, args: readonly string[]) {
  if (args[0] !== "repo" || args[1] !== "features") {
    return executeCli(root, args);
  }
  return runFeatureOperation(
    root,
    parseFeatures(args, builtInFeatureRegistry),
    builtInFeatureRegistry,
    undefined,
    { runFinalTask: () => Promise.resolve(undefined) },
  ).then((output) => ({ output, terminalNewline: true }));
}
