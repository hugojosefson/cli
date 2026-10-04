import { test as nativeTest } from "node:test";
import { pathToFileURL } from "node:url";
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import metadata from "../../deno.json" with { type: "json" };
import { trackTests } from "../testing/inventory-test-fixtures.ts";
import {
  makeTempDir,
  remove,
  writeTextFile,
} from "../testing/files-test-fixtures.ts";
import { runCliProcess } from "../testing/runtime-test-fixtures.ts";
import { formatCliOutput } from "./format-output.ts";
import { runCli } from "./run-cli.ts";
const test = trackTests(import.meta.url, nativeTest);

test("version aliases need no repository or release environment", async () => {
  const services = {
    colors: { stdout: true, stderr: true },
    releaseEnvironment: {
      get: () => {
        throw new Error("Unexpected environment access");
      },
    },
  };
  for (const command of ["--version", "version"]) {
    const result = await runCli(new URL("https://example.com/"), [
      command,
      "--runtime-deno=999.0.0",
      "--offline",
    ], services);
    assertEquals(formatCliOutput(result), `${metadata.version}\n`);
    for (const extra of ["extra", "--unknown", "--version"]) {
      await assertRejects(
        () => runCli(new URL("file:///absent/"), [command, extra], services),
        Error,
        "Expected `hj --version` or `hj version`.",
      );
    }
    for (const help of ["--help", "-h"]) {
      const result = await runCli(new URL("file:///absent/"), [command, help]);
      assertStringIncludes(result.output, "hj version");
      assertStringIncludes(result.output, "hj --version");
    }
  }
  const help = await runCli(new URL("file:///absent/"), ["--help"]);
  assertStringIncludes(help.output, "hj version");
  assertStringIncludes(help.output, "hj --version");
});

test("version output ignores project metadata without application permissions", async () => {
  const directory = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-version-",
  });
  const root = pathToFileURL(`${directory}/`);
  try {
    await writeTextFile(new URL("deno.json", root), '{"version":"999.0.0"}\n');
    await writeTextFile(new URL(".deno-version", root), "invalid\n");
    for (const command of ["--version", "version"]) {
      const result = await runCliProcess([command], {
        cwd: root,
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
      }, true);
      assertEquals(
        result.success,
        true,
        new TextDecoder().decode(result.stderr),
      );
      assertEquals(
        new TextDecoder().decode(result.stdout),
        `${metadata.version}\n`,
      );
      assertEquals(new TextDecoder().decode(result.stderr), "");
    }
  } finally {
    await remove(root, { recursive: true });
  }
});
