import { test as nativeTest } from "node:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertEquals } from "@std/assert";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
import { isolatedReleaseProcess } from "./release-core-test-fixtures.ts";
import { runOrThrow } from "./release-process.ts";
const test = trackTests(import.meta.url, nativeTest);

test("release core subprocesses use explicit environment and disabled Git hooks and signing", async () => {
  const directory = await mkdtemp("/tmp/opencode/hj-isolated-release-");
  const root = pathToFileURL(directory + "/");
  const process = isolatedReleaseProcess(root);
  try {
    const environment = JSON.parse(
      await runOrThrow(process, "deno", [
        "eval",
        "console.log(JSON.stringify(Deno.env.toObject()))",
      ]),
    );
    assertEquals(environment.GIT_CONFIG_GLOBAL, "/dev/null");
    assertEquals(environment.GIT_CONFIG_NOSYSTEM, "1");
    assertEquals(environment.GIT_CONFIG_COUNT, undefined);
    assertEquals(environment.HJ_TEST_SOURCE_ROOT, undefined);
    assertEquals(environment.HJ_TEST_INVENTORY, undefined);
    assertEquals(environment.LC_ALL, "C");
    assertEquals(environment.TZ, "UTC");
    for (
      const [name, expected] of [
        ["core.hooksPath", "/dev/null"],
        ["commit.gpgSign", "false"],
        ["tag.gpgSign", "false"],
        ["init.templateDir", ""],
      ]
    ) {
      assertEquals(
        (await runOrThrow(process, "git", ["config", "--get", name])).trim(),
        expected,
      );
    }
    const result = await process.run("deno", [
      "eval",
      "Deno.stdout.writeSync(new TextEncoder().encode(Deno.env.get('FIXTURE_VALUE'))); Deno.exit(23)",
    ], { env: { FIXTURE_VALUE: "explicit" } });
    assertEquals(result.success, false);
    assertEquals(result.code, 23);
    assertEquals(new TextDecoder().decode(result.stdout), "explicit");
    const nested = new URL("nested/", root);
    await mkdir(nested);
    const input = await runOrThrow(process, "deno", [
      "eval",
      "const bytes = new Uint8Array(64); const length = await Deno.stdin.read(bytes); console.log(JSON.stringify({cwd:Deno.cwd(),input:new TextDecoder().decode(bytes.subarray(0,length ?? 0))}));",
    ], { cwd: nested, stdin: "fixture input" });
    assertEquals(JSON.parse(input), {
      cwd: fileURLToPath(nested).replace(/\/$/, ""),
      input: "fixture input",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
