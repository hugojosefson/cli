import { test as nativeTest } from "node:test";
import { trackTests } from "../../src/testing/inventory-test-fixtures.ts";
import {
  makeTempDir,
  mkdir,
  readTextFile,
  remove,
  writeTextFile,
} from "../../src/testing/files-test-fixtures.ts";
import { assertEquals, assertRejects } from "@std/assert";
import { testFiles } from "./manifest.ts";
import { prepareTestDirectory } from "./output.ts";
import { runRawCommand as runCommand } from "../../src/runtime/command.ts";
const test = trackTests(import.meta.url, nativeTest);

test("discovery includes nested script tests and excludes installed dependency tests", async () => {
  const path = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-discovery-",
  });
  const root = new URL(`file://${path}/`);
  try {
    for (
      const name of [
        "src/a_test.ts",
        "scripts/nested/b_test.ts",
        "scripts/nested/node_modules/package/ignored_test.ts",
        "scripts/.hj/generated/ignored_test.ts",
      ]
    ) {
      const file = new URL(name, root);
      await mkdir(new URL("./", file), { recursive: true });
      await writeTextFile(file, "fixture");
    }
    assertEquals(await testFiles(root), [
      "scripts/nested/b_test.ts",
      "src/a_test.ts",
    ]);
  } finally {
    await remove(path, { recursive: true });
  }
});

test("test output resets only owned real directories and refuses parent symlinks", async () => {
  const path = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-output-",
  });
  const root = new URL(`file://${path}/`);
  try {
    const output = await prepareTestDirectory(root, "test", true);
    await writeTextFile(new URL("obsolete.txt", output), "obsolete");
    await prepareTestDirectory(root, "test", true);
    await assertRejects(() => readTextFile(new URL("obsolete.txt", output)));
    await remove(new URL(".hj-test-build", output));
    await writeTextFile(new URL("keep.txt", output), "keep");
    await assertRejects(
      () => prepareTestDirectory(root, "test", true),
      Error,
      "unowned",
    );
    assertEquals(await readTextFile(new URL("keep.txt", output)), "keep");
    await remove(new URL(".hj/", root), { recursive: true });
    await mkdir(new URL("outside/", root));
    const linked = await runCommand("deno", {
      args: [
        "eval",
        "await Deno.symlink(new URL(Deno.args[0]), new URL(Deno.args[1]));",
        new URL("outside/", root).href,
        new URL(".hj", root).href,
      ],
    });
    assertEquals(linked.success, true);
    await assertRejects(
      () => prepareTestDirectory(root, "test", true),
      Error,
      "real directory",
    );
  } finally {
    await remove(path, { recursive: true });
  }
});
