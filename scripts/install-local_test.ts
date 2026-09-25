import { sourceFile } from "../src/testing/runtime-test-fixtures.ts";
import { test as nativeTest } from "node:test";
import { trackTests } from "../src/testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import {
  makeTempDir,
  readTextFile,
  remove,
} from "../src/testing/files-test-fixtures.ts";
import { runRawCommand as runCommand } from "../src/runtime/command.ts";
import { assertEquals, assertStringIncludes } from "@std/assert";

test("installed hj keeps the caller directory and works outside the checkout", async () => {
  const root = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj install ",
  });
  try {
    const install = await runCommand("deno", {
      args: [
        "run",
        "--allow-env",
        "--allow-run=deno",
        "--allow-read",
        sourceFile("scripts/install-local.ts").href,
        "--root",
        `${root}/tools`,
      ],
      cwd: root,
      stdout: "piped",
      stderr: "piped",
    });
    assertEquals(
      install.success,
      true,
      new TextDecoder().decode(install.stderr),
    );
    const run = async (args: string[]) => {
      const result = await runCommand("sh", {
        args: [`${root}/tools/bin/hj`, ...args],
        cwd: root,
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
      });
      assertEquals(
        result.success,
        true,
        new TextDecoder().decode(result.stderr),
      );
      return new TextDecoder().decode(result.stdout);
    };
    assertStringIncludes(await run(["--help"]), "hj repo features");
    await run(["repo", "features", "--deno-fmt", "--yes"]);
    const config = JSON.parse(await readTextFile(`${root}/deno.jsonc`));
    assertEquals(config.tasks.fmt.command, "deno fmt");
    assertEquals(config.fmt.exclude, ["coverage"]);
  } finally {
    await remove(root, { recursive: true });
  }
});
