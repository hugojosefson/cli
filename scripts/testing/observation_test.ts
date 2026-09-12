import { test as nativeTest } from "node:test";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
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
  focusedGroups,
  focusedTests,
  type ObservedReport,
  observeValidation,
} from "./observation.ts";
const test = trackTests(import.meta.url, nativeTest);
const files = [...focusedTests, "src/unrelated_test.ts"].sort();
const inputsForGroups = (inputs: Record<string, string>) =>
  Object.fromEntries(focusedGroups.map(({ name }) => [name, inputs]));
const snapshot = (version = "1.0.0", context = "deno") =>
  inputSnapshot(
    files,
    inputsForGroups({
      "focused.ts": "same",
      "deno.json (except version)": configurationInput(
        JSON.stringify({ version, imports: { lib: "1.0.0" } }),
      ),
    }),
    { "focused.ts": "same", "deno.json": version },
    context,
    {},
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
  assertEquals(
    before.groups["github-repository"].key,
    after.groups["github-repository"].key,
  );
  assertNotEquals(before.broadKey, after.broadKey);
  const changed = inputSnapshot(
    files,
    inputsForGroups({ "focused.ts": "edited" }),
    after.broadInputs,
    "deno",
    {},
  );
  assertNotEquals(
    after.groups["github-repository"].key,
    changed.groups["github-repository"].key,
  );
  assertNotEquals(
    before.groups["github-repository"].key,
    snapshot("1.0.0", "node24").groups["github-repository"].key,
  );
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
    inputsForGroups({ unit: "same" }),
    { metadata: "old" },
    "deno",
    { "github-repository": ["metadata"] },
  );
  const after = inputSnapshot(
    files,
    inputsForGroups({ unit: "same" }),
    { metadata: "new" },
    "deno",
    { "github-repository": ["metadata"] },
  );
  assertEquals(before.groups["github-repository"].boundary, "conservative");
  assertNotEquals(
    before.groups["github-repository"].key,
    after.groups["github-repository"].key,
  );
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
    await write("src/release/helper.ts", "export const fixture = 1;\n");
    await write("deno.json", '{"version":"1.0.0"}\n');
    await write("deno.lock", '{"version":"5","specifiers":{}}\n');
    await write("toolchain.json", "{}\n");
    await write("scripts/run-tests.ts", "export {};\n");
    const before = await capture();
    assertEquals(before.groups["github-repository"].boundary, "isolated");
    await write("deno.json", '{"version":"2.0.0"}\n');
    const version = await capture();
    assertEquals(
      version.groups["github-repository"].key,
      before.groups["github-repository"].key,
    );
    assertNotEquals(version.broadKey, before.broadKey);
    await write(
      "src/repository/helper.ts",
      'export { fixture } from "./fixture.ts";\n',
    );
    await write("src/repository/fixture.ts", "export const fixture = 2;\n");
    const dependency = await capture();
    assertEquals(
      dependency.groups["release-core"].key,
      version.groups["release-core"].key,
    );
    assertNotEquals(
      dependency.groups["github-repository"].key,
      version.groups["github-repository"].key,
    );
    assertEquals(
      Object.hasOwn(
        dependency.groups["github-repository"].inputs,
        "src/repository/fixture.ts",
      ),
      true,
    );
    await chmod(new URL("src/repository/fixture.ts", root), 0o600);
    const mode = await capture();
    assertNotEquals(
      mode.groups["github-repository"].key,
      dependency.groups["github-repository"].key,
    );
    await write(
      "src/repository/fixture.ts",
      'import config from "../../deno.json" with { type: "json" };\nexport const fixture = config.version;\n',
    );
    const metadata = await capture();
    assertEquals(metadata.groups["github-repository"].boundary, "conservative");
    assertEquals(
      metadata.groups["github-repository"].reasons.includes(
        "Imports actual package metadata",
      ),
      true,
    );
    await write("deno.json", '{"version":"3.0.0"}\n');
    assertNotEquals(
      (await capture()).groups["github-repository"].key,
      metadata.groups["github-repository"].key,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("fresh observations partition all files and retain full native compilation dependency", () => {
  const before = report("node");
  const after = report("node", "2.0.0");
  const group = after.observation!.groups[0];
  assertEquals(group.files, focusedGroups[0].files);
  assertEquals(group.bodyMs, 100);
  assertEquals(group.bodies, 5);
  assertEquals(after.observation!.groups[2].files, ["src/unrelated_test.ts"]);
  const comparison = compareObservations(before, after);
  assertEquals(
    comparison[0].includes(
      "candidate inputs match; current execution inputs changed",
    ),
    true,
  );
  assertEquals(comparison[2].includes("candidate inputs changed"), true);
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

test("schema 1 reports cannot silently enter the schema 2 comparison", () => {
  const previous = report();
  previous.observation!.schema = 1;
  assertThrows(
    () => compareObservations(previous, report()),
    Error,
    "Incompatible observation schema: expected 2, received 1",
  );
});

test("release core code and type imports exclude metadata while production wiring retains it", async () => {
  const root = new URL(process.env.HJ_TEST_SOURCE_ROOT!);
  const inspect = async (file: string) => {
    const { stdout } = await promisify(execFile)(process.env.HJ_TEST_DENO!, [
      "info",
      "--json",
      "--frozen",
      "--config",
      fileURLToPath(new URL("deno.json", root)),
      fileURLToPath(new URL(file, root)),
    ], {
      cwd: root,
      env: { PATH: process.env.PATH ?? "" },
      maxBuffer: 16 * 1024 * 1024,
    });
    return graphInputs(JSON.parse(stdout), root);
  };
  for (
    const file of focusedGroups.find((group) => group.name === "release-core")!
      .files
  ) {
    const graph = await inspect(file);
    assertEquals(graph.reasons, []);
    assertEquals(graph.paths.includes("src/features/deno-config.ts"), false);
    assertEquals(
      graph.paths.includes("src/release/publish-tag-prepare.ts"),
      false,
    );
    assertEquals(
      graph.paths.includes("src/release/publish-tag-prepare-core.ts"),
      true,
    );
  }
  const integration = await inspect(
    "src/release/publish-tag-prepare-integration_test.ts",
  );
  assertEquals(
    integration.paths.includes("src/release/publish-tag-prepare.ts"),
    true,
  );
  assertEquals(
    integration.reasons.includes("Imports actual package metadata"),
    true,
  );
});
