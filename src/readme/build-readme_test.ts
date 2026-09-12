import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import {
  makeTempDir,
  mkdir,
  remove,
  writeTextFile,
} from "../testing/files-test-fixtures.ts";
import { runCommand } from "../runtime/command.ts";
import { assertEquals, assertRejects } from "@std/assert";
import { buildReadme } from "./build-readme.ts";
import { readReadmeFile } from "./readme-path.ts";

test("builds nested README includes with links and TypeScript package imports", async () => {
  await withRepository(async (root) => {
    await write(
      root,
      "deno.jsonc",
      `{"name":"@scope/pkg","exports":{".":"./mod.ts","./tool":"./src/tool.ts","./nested":"./readme/parts/nested.ts"}}`,
    );
    await write(root, "mod.ts", "export {}\n");
    await write(root, "src/tool.ts", "export {}\n");
    await write(
      root,
      "readme/README.md",
      "# README\n@@include( parts/example.ts )\n[guide](guide.md)\n",
    );
    await write(
      root,
      "readme/parts/example.ts",
      '#!/usr/bin/env deno run\nimport {} from "../../mod.ts";\nimport {} from "./nested.ts";\n@@include(nested.ts)\n',
    );
    await write(
      root,
      "readme/parts/nested.ts",
      '#!/usr/bin/env deno run\nexport {} from "../../src/tool.ts";\n',
    );
    assertEquals(
      await buildReadme(root),
      '# README\nimport {} from "@scope/pkg";\nimport {} from "@scope/pkg/nested";\nexport {} from "@scope/pkg/tool";\n\n\n[guide](readme/guide.md)\n',
    );
  });
});

test("trims exact nested include directives and omits each shebang", async () => {
  await withRepository(async (root) => {
    await write(
      root,
      "readme/README.md",
      "before\n @@include( nested.md ) \nafter\n",
    );
    await write(root, "readme/nested.md", "#!/usr/bin/env deno run\ninside\n");
    assertEquals(await buildReadme(root), "before\ninside\n\nafter\n");
  });
});

test("does not rewrite links in fenced Markdown code", async () => {
  await withRepository(async (root) => {
    await write(
      root,
      "readme/README.md",
      "[link](guide.md)\n```ts\n[code](guide.md)\n```\n",
    );
    assertEquals(
      await buildReadme(root),
      "[link](readme/guide.md)\n```ts\n[code](guide.md)\n```\n",
    );
  });
});

test("leaves imports without an exact package export unchanged", async () => {
  await withRepository(async (root) => {
    await write(
      root,
      "deno.json",
      `{"name":"@scope/pkg","exports":"./mod.ts"}`,
    );
    await write(root, "readme/README.md", "@@include(example.ts)\n");
    await write(root, "readme/example.ts", 'import {} from "../other.ts";\n');
    assertEquals(await buildReadme(root), 'import {} from "../other.ts";\n\n');
  });
});

test("rejects README paths that are not regular files", async () => {
  await withRepository(async (root) => {
    await mkdir(new URL("readme/directory", root), { recursive: true });
    await assertRejects(
      () => readReadmeFile(root.pathname, root.pathname, "readme/directory"),
      Error,
      "not a regular file",
    );
  });
});

test("rejects circular, escaping, and symlinked README includes", async () => {
  await withRepository(async (root) => {
    await write(root, "readme/README.md", "@@include(two.md)\n");
    await write(root, "readme/two.md", "@@include(README.md)\n");
    await assertRejects(
      () => buildReadme(root),
      Error,
      "Circular README include",
    );
    await write(root, "readme/README.md", "@@include(../../outside.md)\n");
    await assertRejects(
      () => buildReadme(root),
      Error,
      "escapes repository root",
    );
    await write(root, "readme/README.md", "@@include(link.md)\n");
    await write(root, "safe.md", "safe\n");
    await symlink(
      new URL("../safe.md", root),
      new URL("readme/link.md", root),
    );
    await assertRejects(() => buildReadme(root), Error, "traverses a symlink");
  });
});

async function withRepository(
  action: (root: URL) => Promise<void>,
): Promise<void> {
  const path = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-readme-",
  });
  try {
    await action(new URL(`file://${path}/`));
  } finally {
    await remove(path, { recursive: true });
  }
}

async function write(root: URL, path: string, text: string): Promise<void> {
  const target = new URL(path, root);
  await mkdir(new URL(".", target), { recursive: true });
  await writeTextFile(target, text);
}

async function symlink(target: URL, path: URL): Promise<void> {
  const result = await runCommand("deno", {
    args: [
      "eval",
      "await Deno.symlink(Deno.args[0], Deno.args[1]);",
      target.pathname,
      path.pathname,
    ],
  });
  if (!result.success) throw new Error(new TextDecoder().decode(result.stderr));
}
