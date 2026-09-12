import { test as nativeTest } from "node:test";
import { trackTests } from "./inventory-test-fixtures.ts";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  assertMissingFile,
  makeTempDir,
  readTextFile,
  remove,
  writeTextFile,
} from "./files-test-fixtures.ts";
import { runHostTests } from "./runtime-test-fixtures.ts";
import { runRawCommand as runCommand } from "../runtime/command.ts";
import {
  compareInventories,
  executedInventory,
} from "../../scripts/testing/manifest.ts";
const test = trackTests(import.meta.url, nativeTest);

test("every host propagates body, nested, awaited cleanup, and subprocess failures", async () => {
  const root = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-runner-failure-",
  });
  try {
    const file = `${root}/contract.test.mjs`;
    for (
      const body of [
        'throw new Error("EXPECTED_BODY_FAILURE")',
        'await t.test("nested", () => { throw new Error("EXPECTED_NESTED_FAILURE") });',
        'try { console.log("body ran"); } finally { await Promise.resolve(); throw new Error("EXPECTED_CLEANUP_FAILURE"); }',
        `const child = spawnSync(process.execPath, [process.versions.deno ? "eval" : "--eval", ${
          JSON.stringify(
            'import("node:process").then(({default:p}) => p.exit(19))',
          )
        }]); if(child.status !== 19) throw new Error("Child fixture failed to exit 19"); throw new Error("EXPECTED_CHILD_FAILURE");`,
      ]
    ) {
      await writeTextFile(
        file,
        `import { test } from "node:test"; import process from "node:process"; import { spawnSync } from "node:child_process"; test("contract", async(t) => { ${body} });`,
      );
      const failed = await runHostTests(file);
      assertEquals(failed.success, false, body);
      assertStringIncludes(
        new TextDecoder().decode(failed.stdout) +
          new TextDecoder().decode(failed.stderr),
        "EXPECTED_",
      );
    }
    await writeTextFile(
      file,
      'import { test } from "node:test"; test("control", async(t) => { await t.test("nested control", async() => { try { await Promise.resolve(); } finally { await Promise.resolve(); } }); });',
    );
    const passed = await runHostTests(file);
    assert(passed.success, new TextDecoder().decode(passed.stderr));
  } finally {
    await remove(root, { recursive: true });
  }
});

test("every host verifies real Deno resource and operation leaks plus sandbox denial", async () => {
  const root = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-deno-contract-",
  });
  try {
    const file = `${root}/contract.test.ts`;
    const resource = `${root}/resource.txt`;
    await writeTextFile(resource, "fixture");
    const execute = (permissions: string[]) =>
      runCommand("deno", {
        args: [
          "test",
          "--no-config",
          "--no-lock",
          "--sanitize-resources",
          "--sanitize-ops",
          ...permissions,
          file,
        ],
      });
    for (const close of [false, true]) {
      await writeTextFile(
        file,
        `Deno.test("resource control", async () => { const file = await Deno.open(${
          JSON.stringify(resource)
        }); ${close ? "file.close();" : ""} });`,
      );
      const result = await execute([`--allow-read=${root}`]);
      assertEquals(
        result.success,
        close,
        new TextDecoder().decode(result.stderr),
      );
      if (!close) {
        assertStringIncludes(
          new TextDecoder().decode(result.stdout) +
            new TextDecoder().decode(result.stderr),
          "A file was opened during the test, but not closed",
        );
      }
    }
    for (const clear of [false, true]) {
      await writeTextFile(
        file,
        `Deno.test("operation control", () => { const timer = setTimeout(() => {}, 60_000); ${
          clear ? "clearTimeout(timer);" : ""
        } });`,
      );
      const result = await execute([]);
      assertEquals(
        result.success,
        clear,
        new TextDecoder().decode(result.stderr),
      );
      if (!clear) {
        assertStringIncludes(
          new TextDecoder().decode(result.stdout) +
            new TextDecoder().decode(result.stderr),
          "A timer was started in this test, but never completed",
        );
      }
    }
    const denied = `${root}/denied.txt`;
    await writeTextFile(
      file,
      `Deno.test("permission control", async () => { await Deno.writeTextFile(${
        JSON.stringify(denied)
      }, "allowed"); });`,
    );
    const forbidden = await execute([]);
    assertEquals(forbidden.success, false);
    assertStringIncludes(
      new TextDecoder().decode(forbidden.stdout) +
        new TextDecoder().decode(forbidden.stderr),
      "Requires write access",
    );
    await assertMissingFile(() => readTextFile(denied));
    const permitted = await execute([`--allow-write=${denied}`]);
    assert(permitted.success, new TextDecoder().decode(permitted.stderr));
    assertEquals(await readTextFile(denied), "allowed");
  } finally {
    await remove(root, { recursive: true });
  }
});

test("inventory rejects missing execution, skips, failures and duplicate identities", () => {
  for (
    const states of [[], ["registered"], ["registered", "started"], [
      "registered",
      "started",
      "failed",
    ], ["registered", "started", "passed", "registered", "started", "passed"]]
  ) {
    let rejected = false;
    try {
      executedInventory(states.map((state) => ({ id: "fixture", state })));
    } catch {
      rejected = true;
    }
    assert(rejected, states.join());
  }
  assertEquals(
    executedInventory(
      ["registered", "started", "passed"].map((state) => ({
        id: "fixture",
        state,
      })),
    ),
    ["fixture"],
  );
});

test("matrix comparison rejects partial, failed, absent or differing runtime reports", () => {
  const valid = {
    runtime: "fixture",
    complete: true,
    success: true,
    files: ["fixture_test.ts"],
    tests: ["fixture > body"],
  };
  compareInventories([valid, valid, valid, valid]);
  for (
    const changed of [
      { ...valid, complete: false },
      { ...valid, success: false },
      { ...valid, files: [] },
      { ...valid, tests: [] },
      { ...valid, files: ["different_test.ts"] },
      { ...valid, tests: ["different body"] },
    ]
  ) {
    let rejected = false;
    try {
      compareInventories([valid, valid, valid, changed]);
    } catch {
      rejected = true;
    }
    assert(rejected, JSON.stringify(changed));
  }
  let missing = false;
  try {
    compareInventories([valid, valid, valid]);
  } catch {
    missing = true;
  }
  assert(missing);
});
