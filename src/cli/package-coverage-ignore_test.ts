import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import {
  fixtureReadDirSync,
  fixtureStat,
  makeTempDir,
  readTextFile,
  remove,
  writeTextFile,
} from "../testing/files-test-fixtures.ts";
import { runRawCommand as runCommand } from "../runtime/command.ts";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, toFileUrl } from "@std/path";
import { builtInFeatureRegistry } from "../features/built-in-feature-registry.ts";
import { parseFeatures } from "./parse-features.ts";
import { runFeatureOperation } from "./run-features.ts";

test("configured CLI identity composes with coverage and conditional ignores", async () => {
  const path = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "deno Different_Directory ",
  });
  const root = toFileUrl(`${path}/`);
  try {
    await writeTextFile(
      new URL("deno.jsonc", root),
      '{\n  // Preserve project configuration.\n  "name": "@acme/actual-tool",\n  "nodeModulesDir": "auto"\n}\n',
    );
    await writeTextFile(new URL(".gitignore", root), "keep.log\n");
    const apply = (...flags: string[]) =>
      runFeatureOperation(
        root,
        parseFeatures(
          ["repo", "features", ...flags, "--yes"],
          builtInFeatureRegistry,
        ),
        builtInFeatureRegistry,
        undefined,
        // This test executes generated local tests below without fetching hj.
        { runFinalTask: () => Promise.resolve(undefined) },
      );

    await apply("--deno-cli", "--deno-test", "--git-ignore");
    const config = await readTextFile(new URL("deno.jsonc", root));
    assertStringIncludes(config, "// Preserve project configuration.");
    assertStringIncludes(config, '"name": "@acme/actual-tool"');
    const initialIgnore = await readTextFile(new URL(".gitignore", root));
    for (
      const entry of ["keep.log", ".*.swp", "/coverage/", "/node_modules/"]
    ) {
      assert(initialIgnore.split(/\r?\n/).includes(entry), entry);
    }

    // Module-relative identity must work from outside the generated project.
    const help = await runCommand("deno", {
      args: ["run", fromFileUrl(new URL("src/cli/cli.ts", root)), "help"],
      cwd: "/tmp/opencode",
    });
    assert(help.success, new TextDecoder().decode(help.stderr));
    assertStringIncludes(new TextDecoder().decode(help.stdout), "actual-tool");

    const tests = await runCommand("deno", {
      args: ["task", "test"],
      cwd: path,
    });
    assert(tests.success, new TextDecoder().decode(tests.stderr));
    assert((await fixtureStat(new URL("coverage/", root))).isDirectory);
    const ignored = [...fixtureReadDirSync(new URL("coverage/", root))];
    assert(ignored.length > 0, "ordinary tests must collect fresh coverage");

    assertStringIncludes(
      await apply("--deno-cli", "--deno-test", "--git-ignore"),
      "No changes.",
    );
    await apply("--no-deno-test");
    const finalIgnore = await readTextFile(new URL(".gitignore", root));
    assertEquals(finalIgnore.split(/\r?\n/).includes("/coverage/"), false);
    for (const entry of ["keep.log", ".*.swp", "/node_modules/"]) {
      assert(finalIgnore.split(/\r?\n/).includes(entry), entry);
    }
    assertStringIncludes(
      await readTextFile(new URL("deno.jsonc", root)),
      '"name": "@acme/actual-tool"',
    );
  } finally {
    await remove(path, { recursive: true });
  }
});
