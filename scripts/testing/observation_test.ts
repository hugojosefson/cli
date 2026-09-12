import { test as nativeTest } from "node:test";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { assertEquals, assertNotEquals, assertThrows } from "@std/assert";
import { trackTests } from "../../src/testing/inventory-test-fixtures.ts";
import {
  captureInputs,
  configurationInput,
  graphInputs,
  inputSnapshot,
} from "./observation-inputs.ts";
import {
  bodyTimings,
  compareObservations,
  focusedTests,
  type ObservedReport,
  observeValidation,
} from "./observation.ts";
const test = trackTests(import.meta.url, nativeTest);
const files = [...focusedTests, "src/unrelated_test.ts"].sort();
const snapshot = (version = "1.0.0", context = "deno") =>
  inputSnapshot(
    files,
    {
      "focused.ts": "same",
      "deno.json (except version)": configurationInput(
        JSON.stringify({ version, imports: { lib: "1.0.0" } }),
      ),
    },
    { "focused.ts": "same", "deno.json": version },
    context,
    [],
  );
const events = files.flatMap((file) => [
  { id: `${file} > test #1`, state: "registered", topLevel: true, timeMs: 0 },
  { id: `${file} > test #1`, state: "started", topLevel: true, timeMs: 10 },
  { id: `${file} > test #1`, state: "passed", topLevel: true, timeMs: 30 },
]);
function report(runtime = "deno", version = "1.0.0"): ObservedReport {
  const value = {
    runtime,
    version: "test-runtime",
    files,
    tests: files.map((file) => `${file} > test #1`),
    complete: true,
    success: true,
  };
  return {
    ...value,
    observation: observeValidation(
      value,
      events,
      snapshot(version, runtime),
      snapshot(version, runtime),
      200,
    ),
  };
}

test("version changes preserve focused inputs but invalidate the conservative remainder", () => {
  const before = snapshot();
  const after = snapshot("2.0.0");
  assertEquals(before.focusedKey, after.focusedKey);
  assertNotEquals(before.broadKey, after.broadKey);
  const changed = inputSnapshot(
    files,
    { "focused.ts": "edited" },
    after.broadInputs,
    "deno",
    [],
  );
  assertNotEquals(after.focusedKey, changed.focusedKey);
  assertNotEquals(before.focusedKey, snapshot("1.0.0", "node24").focusedKey);
  assertNotEquals(
    configurationInput('{"version":"1.0.0","imports":{"lib":"1.0.0"}}'),
    configurationInput('{"version":"1.0.0","imports":{"lib":"2.0.0"}}'),
  );
});

test("metadata and external imports force a conservative boundary", () => {
  const root = new URL("file:///repo/");
  assertEquals(
    graphInputs({
      modules: [
        { specifier: "file:///repo/src/unit.ts" },
        { specifier: "file:///repo/deno.json" },
        { specifier: "file:///outside.ts" },
      ],
    }, root),
    {
      paths: ["deno.json", "src/unit.ts"],
      reasons: [
        "Import outside the repository",
        "Imports actual package metadata",
      ],
    },
  );
  const before = inputSnapshot(
    files,
    { unit: "same" },
    { metadata: "old" },
    "deno",
    ["metadata"],
  );
  const after = inputSnapshot(
    files,
    { unit: "same" },
    { metadata: "new" },
    "deno",
    ["metadata"],
  );
  assertEquals(before.boundary, "conservative");
  assertNotEquals(before.focusedKey, after.focusedKey);
});

test("body timing excludes nested subtests and rejects missing timestamps", () => {
  const id = "src/example_test.ts > parent > literal separator #1";
  const nested = id + " > child #1";
  assertEquals([...bodyTimings([
    { id, state: "started", topLevel: true, timeMs: 10 },
    { id: nested, state: "started", topLevel: false, timeMs: 20 },
    { id: nested, state: "passed", topLevel: false, timeMs: 80 },
    { id, state: "passed", topLevel: true, timeMs: 100 },
  ])], [["src/example_test.ts", 90]]);
  assertThrows(
    () => bodyTimings([{ id, state: "started", topLevel: true }]),
    Error,
    "Missing body timing",
  );
});

test("real input capture tracks version, transitive imports, permissions and metadata reads", async () => {
  const directory = await mkdtemp("/tmp/opencode/hj-observation-");
  const root = pathToFileURL(directory + "/");
  const write = async (path: string, text: string) => {
    const file = new URL(path, root);
    await mkdir(new URL("./", file), { recursive: true });
    await writeFile(file, text);
  };
  const capture = () =>
    captureInputs(
      root,
      focusedTests,
      process.env.HJ_TEST_DENO ?? "deno",
      "fixture",
      { PATH: process.env.PATH ?? "" },
    );
  try {
    await promisify(execFile)("git", ["init", "--quiet", directory], {
      env: { PATH: process.env.PATH ?? "" },
    });
    for (const file of focusedTests) {
      await write(file, 'import "./helper.ts";\n');
    }
    await write("src/repository/helper.ts", "export const fixture = 1;\n");
    await write("deno.json", '{"version":"1.0.0"}\n');
    await write("deno.lock", '{"version":"5","specifiers":{}}\n');
    await write("toolchain.json", "{}\n");
    await write("scripts/run-tests.ts", "export {};\n");
    const before = await capture();
    assertEquals(before.boundary, "isolated");
    await write("deno.json", '{"version":"2.0.0"}\n');
    const version = await capture();
    assertEquals(version.focusedKey, before.focusedKey);
    assertNotEquals(version.broadKey, before.broadKey);
    await write(
      "src/repository/helper.ts",
      'export { fixture } from "./fixture.ts";\n',
    );
    await write("src/repository/fixture.ts", "export const fixture = 2;\n");
    const dependency = await capture();
    assertNotEquals(dependency.focusedKey, version.focusedKey);
    assertEquals(
      Object.hasOwn(dependency.focusedInputs, "src/repository/fixture.ts"),
      true,
    );
    await chmod(new URL("src/repository/fixture.ts", root), 0o600);
    const mode = await capture();
    assertNotEquals(mode.focusedKey, dependency.focusedKey);
    await write(
      "src/repository/fixture.ts",
      'import config from "../../deno.json" with { type: "json" };\nexport const fixture = config.version;\n',
    );
    const metadata = await capture();
    assertEquals(metadata.boundary, "conservative");
    assertEquals(
      metadata.reasons.includes("Imports actual package metadata"),
      true,
    );
    await write("deno.json", '{"version":"3.0.0"}\n');
    assertNotEquals((await capture()).focusedKey, metadata.focusedKey);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("fresh observations partition all files and retain full native compilation dependency", () => {
  const before = report("node");
  const after = report("node", "2.0.0");
  const group = after.observation!.groups[0];
  assertEquals(group.files, focusedTests);
  assertEquals(group.bodyMs, 100);
  assertEquals(group.bodies, 5);
  assertEquals(after.observation!.groups[1].files, ["src/unrelated_test.ts"]);
  const comparison = compareObservations(before, after);
  assertEquals(
    comparison[0].includes(
      "candidate inputs match; current execution inputs changed",
    ),
    true,
  );
  assertEquals(comparison[1].includes("candidate inputs changed"), true);
});

test("failed, incomplete, changed-during-run and duplicate observations cannot be compared", () => {
  for (
    const change of [
      (value: ObservedReport) => {
        value.complete = false;
      },
      (value: ObservedReport) => {
        value.success = false;
      },
      (value: ObservedReport) => {
        value.observation!.stableInputs = false;
      },
      (value: ObservedReport) => {
        value.observation!.groups[1].files.push(focusedTests[0]);
      },
    ]
  ) {
    const value = report();
    change(value);
    assertThrows(() => compareObservations(report(), value));
  }
  const value = report();
  assertEquals(
    observeValidation(value, events, snapshot(), snapshot("2.0.0"), 200)
      .stableInputs,
    false,
  );
  assertThrows(() =>
    observeValidation(
      { ...value, complete: false },
      events,
      snapshot(),
      snapshot(),
      200,
    )
  );
});
