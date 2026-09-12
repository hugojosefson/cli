import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test as nativeTest } from "node:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import process from "node:process";
import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import { trackTests } from "../../src/testing/inventory-test-fixtures.ts";
import { nativeBuildInputs } from "./native-build-inputs.ts";
import {
  finishNativeBuild,
  nativeReceiptPath,
} from "./native-build-receipt.ts";
import { nativeGraph } from "./native-graph.ts";
import { nativeTree } from "./native-files.ts";
import { captureNativeInputs } from "./native-observation.ts";
import { focusedTests } from "./observation.ts";
const test = trackTests(import.meta.url, nativeTest);
const execute = promisify(execFile);
async function symlink(target: string, path: URL) {
  const quote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
  await execute("sh", [
    "-c",
    `/bin/ln -s -- ${quote(target)} ${quote(fileURLToPath(path))}`,
  ], { env: { PATH: process.env.PATH ?? "" } });
}

async function fixture() {
  const directory = await mkdtemp("/tmp/opencode/hj-native-inputs-");
  const root = pathToFileURL(directory + "/");
  const deno = process.env.HJ_TEST_DENO!;
  async function put(path: string, text: string) {
    const target = new URL(path, root);
    await mkdir(new URL("./", target), { recursive: true });
    await writeFile(target, text);
  }
  for (
    const path of ["src/", "scripts/", "bin/", ".hj/test/node_modules/probe/"]
  ) {
    await mkdir(new URL(path, root), { recursive: true });
  }
  for (const name of ["node", "npm", "git"]) {
    await symlink(deno, new URL("bin/" + name, root));
  }
  for (
    const [path, value] of Object.entries({
      "deno.json": '{"version":"1.0.0"}',
      "deno.lock": "{}",
      "toolchain.json": "{}",
      ".hj/test/package.json": '{"type":"module"}',
      ".hj/test/package-lock.json": "{}",
      ".hj/test/node_modules/probe/package.json":
        '{"name":"probe","exports":"./index.js","type":"module"}',
      ".hj/test/node_modules/probe/index.js": "export const value = 1;",
    })
  ) await put(path, value);
  for (const file of focusedTests) {
    await put(file, "export {};");
    await put(
      ".hj/test/esm/" + file.replace(/\.ts$/, ".js"),
      'import "probe";',
    );
  }
  const path = fileURLToPath(new URL("bin/", root));
  const environment = { PATH: path, HJ_TEST_DENO: deno };
  async function build() {
    await rm(new URL(nativeReceiptPath, root), { force: true });
    const before = await nativeBuildInputs(root, deno, path);
    await finishNativeBuild(root, before, deno, path, 10, 2);
  }
  const capture = () => captureNativeInputs(root, "node", deno, environment);
  return { root, directory, deno, path, put, build, capture };
}

test("native receipts reject stale source and preserve version-independent keys", async () => {
  const f = await fixture();
  try {
    await f.build();
    const before = await f.capture();
    await f.put("deno.json", '{"version":"1.0.1"}');
    await assertRejects(f.capture, Error, "receipt does not agree");
    await f.build();
    const version = await f.capture();
    assertEquals(version.groups, before.groups);
    // The fixture keeps package metadata fixed. A real dnt build can add exports.
    await f.put("src/remainder_test.ts", "export {};");
    await f.put(".hj/test/esm/src/remainder_test.js", "export {};");
    await assertRejects(f.capture, Error, "receipt does not agree");
    await f.build();
    const added = await f.capture();
    assertEquals(added.groups, before.groups);
    assertEquals(added.inventory.includes("src/remainder_test.ts"), true);
    await f.put(focusedTests[0], "export const changed = true;");
    await f.build();
    const changed = await f.capture();
    assertNotEquals(
      changed.groups["github-repository"].key,
      before.groups["github-repository"].key,
    );
    assertEquals(
      changed.groups["release-core"].key,
      before.groups["release-core"].key,
    );
  } finally {
    await rm(f.directory, { recursive: true });
  }
});

test("native receipts check dependency bytes, modes, and missing imports", async () => {
  const f = await fixture();
  try {
    await f.build();
    const before = await f.capture();
    const dependency = new URL(".hj/test/node_modules/probe/index.js", f.root);
    await writeFile(dependency, "export const value = 2;");
    await assertRejects(f.capture, Error, "receipt does not agree");
    await f.build();
    const changed = await f.capture();
    for (const name of Object.keys(before.groups)) {
      assertNotEquals(before.groups[name].key, changed.groups[name].key);
    }
    await chmod(dependency, 0o600);
    await assertRejects(f.capture, Error, "receipt does not agree");
    await rm(dependency);
    await assertRejects(
      f.build,
      Error,
      "Native import resolution did not succeed",
    );
  } finally {
    await rm(f.directory, { recursive: true });
  }
});

test("native builds reject source changes during compilation and computed imports", async () => {
  const f = await fixture();
  try {
    const before = await nativeBuildInputs(f.root, f.deno, f.path);
    await f.put("src/added.ts", "export {};");
    await assertRejects(
      () => finishNativeBuild(f.root, before, f.deno, f.path, 1, 1),
      Error,
      "inputs changed",
    );
    await assertRejects(() => readFile(new URL(nativeReceiptPath, f.root)));
    await f.put(
      ".hj/test/esm/" + focusedTests[0].replace(/\.ts$/, ".js"),
      'const path = "./missing.js"; import(path);',
    );
    await assertRejects(
      () => nativeGraph(f.root, [focusedTests[0]], f.deno),
      Error,
      "expression needs inspection",
    );
    await symlink(
      "/dev/null",
      new URL(".hj/test/node_modules/outside", f.root),
    );
    await assertRejects(
      () => nativeTree(new URL(".hj/test/node_modules/", f.root)),
      Error,
      "link leaves",
    );
  } finally {
    await rm(f.directory, { recursive: true });
  }
});

test("native tool identity detects replacement bytes with an unchanged version", async () => {
  const directory = await mkdtemp("/tmp/opencode/hj-native-tool-");
  try {
    const tool = directory + "/tool";
    const helper = directory + "/probe.ts";
    const module = new URL(
      "scripts/testing/native-tools.ts",
      process.env.HJ_TEST_SOURCE_ROOT,
    ).href;
    await writeFile(tool, "#!/bin/sh\necho 1.0.0\n");
    await chmod(tool, 0o700);
    await writeFile(
      helper,
      `import { nativeTool } from ${
        JSON.stringify(module)
      };\nconsole.log(JSON.stringify(await nativeTool(Deno.args[0])));\n`,
    );
    const identity = async () => {
      const { stdout } = await execute(process.env.HJ_TEST_DENO!, [
        "run",
        "--no-config",
        "--no-lock",
        "--allow-env=NODE_V8_COVERAGE",
        `--allow-read=${directory}`,
        `--allow-run=${tool}`,
        helper,
        tool,
      ], { env: { PATH: process.env.PATH ?? "" } });
      return JSON.parse(stdout);
    };
    const before = await identity();
    await writeFile(tool, "#!/bin/sh\n# Changed bytes.\necho 1.0.0\n");
    const after = await identity();
    assertEquals(before.version, after.version);
    assertNotEquals(before.file.digest, after.file.digest);
  } finally {
    await rm(directory, { recursive: true });
  }
});
