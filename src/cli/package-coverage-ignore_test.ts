import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, toFileUrl } from "@std/path";
import { builtInFeatureRegistry } from "../features/built-in-feature-registry.ts";
import { parseFeatures } from "./parse-features.ts";
import { runFeatures } from "./run-features.ts";

Deno.test("configured CLI identity composes with coverage and conditional ignores", async () => {
  const path = await Deno.makeTempDir({
    dir: "/tmp/opencode",
    prefix: "deno Different_Directory ",
  });
  const root = toFileUrl(`${path}/`);
  try {
    await Deno.writeTextFile(
      new URL("deno.jsonc", root),
      '{\n  // Preserve project configuration.\n  "name": "@acme/actual-tool",\n  "nodeModulesDir": "auto"\n}\n',
    );
    await Deno.writeTextFile(new URL(".gitignore", root), "keep.log\n");
    const apply = (...flags: string[]) =>
      runFeatures(
        root,
        parseFeatures(
          ["repo", "features", ...flags, "--yes"],
          builtInFeatureRegistry,
        ),
      );

    await apply("--deno-cli", "--deno-test", "--git-ignore");
    const config = await Deno.readTextFile(new URL("deno.jsonc", root));
    assertStringIncludes(config, "// Preserve project configuration.");
    assertStringIncludes(config, '"name": "@acme/actual-tool"');
    const initialIgnore = await Deno.readTextFile(new URL(".gitignore", root));
    for (
      const entry of ["keep.log", ".*.swp", "/coverage/", "/node_modules/"]
    ) {
      assert(initialIgnore.split(/\r?\n/).includes(entry), entry);
    }

    // Module-relative identity must work from outside the generated project.
    const help = await new Deno.Command("deno", {
      args: ["run", fromFileUrl(new URL("src/cli/cli.ts", root)), "help"],
      cwd: "/tmp/opencode",
    }).output();
    assert(help.success, new TextDecoder().decode(help.stderr));
    assertStringIncludes(new TextDecoder().decode(help.stdout), "actual-tool");

    const tests = await new Deno.Command("deno", {
      args: ["task", "test"],
      cwd: path,
    }).output();
    assert(tests.success, new TextDecoder().decode(tests.stderr));
    assert((await Deno.stat(new URL("coverage/", root))).isDirectory);
    const ignored = [...Deno.readDirSync(new URL("coverage/", root))];
    assert(ignored.length > 0, "ordinary tests must collect fresh coverage");

    assertStringIncludes(
      await apply("--deno-cli", "--deno-test", "--git-ignore"),
      "No changes.",
    );
    await apply("--no-deno-test");
    const finalIgnore = await Deno.readTextFile(new URL(".gitignore", root));
    assertEquals(finalIgnore.split(/\r?\n/).includes("/coverage/"), false);
    for (const entry of ["keep.log", ".*.swp", "/node_modules/"]) {
      assert(finalIgnore.split(/\r?\n/).includes(entry), entry);
    }
    assertStringIncludes(
      await Deno.readTextFile(new URL("deno.jsonc", root)),
      '"name": "@acme/actual-tool"',
    );
  } finally {
    await Deno.remove(path, { recursive: true });
  }
});
