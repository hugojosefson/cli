import { test as nativeTest } from "node:test";
import { assertEquals, assertThrows } from "@std/assert";
import { trackTests } from "../../src/testing/inventory-test-fixtures.ts";
import { nativeCommandPlan } from "./native-command-plan.ts";
import { nativeEnvironmentForTools } from "./native-environment.ts";
import { nativeResult } from "./native-result.ts";
import { compareNativeObservation } from "./native-comparison.ts";
import { focusedTests } from "./observation.ts";
import type { NativeSnapshot } from "./native-types.ts";
const test = trackTests(import.meta.url, nativeTest);

test("native command plans partition the inventory without duplicate execution", () => {
  const files = [...focusedTests, "src/other_test.ts"].sort();
  for (const runtime of ["node", "bun"]) {
    const plan = nativeCommandPlan(runtime, files, new URL("file:///emitted/"));
    const selected = plan.flatMap((command) =>
      command.args.filter((arg) => arg.endsWith("_test.js"))
    );
    assertEquals(
      selected.sort(),
      files.map((file) => "/emitted/" + file.replace(/\.ts$/, ".js")).sort(),
    );
    assertEquals(plan.filter((command) => !command.focused).length, 1);
    const filtered = nativeCommandPlan(
      runtime,
      [files[0]],
      new URL("file:///emitted/"),
      "selected",
    );
    assertEquals(filtered.length, 1);
    assertEquals(filtered[0].args.includes("--test-name-pattern"), true);
  }
});

test("native focused environments do not include loader options or credentials", () => {
  const environment = nativeEnvironmentForTools("/tools/deno", "/git/bin/git");
  assertEquals(Object.keys(environment).sort(), [
    "DENO_NO_UPDATE_CHECK",
    "GIT_ATTR_NOSYSTEM",
    "GIT_CONFIG_GLOBAL",
    "GIT_CONFIG_NOSYSTEM",
    "GIT_CONFIG_SYSTEM",
    "GIT_TERMINAL_PROMPT",
    "HJ_TEST_DENO",
    "LANG",
    "LC_ALL",
    "NO_COLOR",
    "PATH",
    "TZ",
  ]);
  assertEquals(environment.PATH, "/tools:/git/bin:/usr/bin:/bin");
  assertEquals(environment.GIT_CONFIG_GLOBAL, "/dev/null");
});

test("native results reject reports without full test execution", () => {
  const files = ["src/example_test.ts"];
  const report = {
    runtime: "node",
    complete: true,
    success: true,
    files,
    tests: [files[0] + " > example #1"],
  };
  const snapshot: NativeSnapshot = {
    schema: 1,
    inventory: files,
    context: "context",
    receipt: "receipt",
    groups: {
      "release-core": { key: "key", inputs: { dependency: "same" } },
    },
    dependencyFiles: 1,
    dependencyBytes: 1,
    buildMs: 1,
    buildObservationMs: 1,
  };
  const value = nativeResult(report, snapshot, snapshot, 1);
  assertEquals(value.cacheEligible, false);
  const added = { ...snapshot, inventory: [...files, "src/added_test.ts"] };
  assertThrows(() => nativeResult(report, added, added, 1));
  assertThrows(() =>
    nativeResult({ ...report, complete: false }, snapshot, snapshot, 1)
  );
  assertThrows(() =>
    nativeResult({ ...report, success: false }, snapshot, snapshot, 1)
  );
  assertThrows(() =>
    nativeResult({ ...report, files: [] }, snapshot, snapshot, 1)
  );
  assertThrows(() =>
    nativeResult(report, snapshot, { ...snapshot, context: "changed" }, 1)
  );
  assertEquals(
    compareNativeObservation(value, value, "release-core"),
    " Native proposed inputs agree. Cache restoration is disabled.",
  );
  assertThrows(() =>
    compareNativeObservation(
      value,
      { ...value, schema: 2 } as never,
      "release-core",
    )
  );
});
