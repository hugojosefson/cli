import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import {
  makeTempDir,
  remove,
  writeTextFile,
} from "../testing/files-test-fixtures.ts";
import { assertEquals } from "@std/assert";
import { rewriteMarkdownLinks } from "./markdown-link.ts";
import { packageImports, rewritePackageImport } from "./package-import.ts";

test("rewrites only relative Markdown link destinations", () => {
  const root = "/repository";
  const file = "/repository/readme/part.md";
  assertEquals(
    rewriteMarkdownLinks(
      "[local](guide.md#start) [web](https://example.invalid) [anchor](#top)",
      file,
      root,
    ),
    "[local](readme/guide.md#start) [web](https://example.invalid) [anchor](#top)",
  );
  assertEquals(
    rewriteMarkdownLinks("[bad](bad%zz.md) `[code](guide.md)`", file, root),
    "[bad](bad%zz.md) `[code](guide.md)`",
  );
});

test("rewrites TypeScript declarations without touching comments or strings", () => {
  const imports = new Map([["/repository/mod.ts", "@scope/pkg"]]);
  assertEquals(
    rewritePackageImport(
      'import {} from "../../mod.ts";',
      "/repository/readme/part/example.ts",
      imports,
    ),
    'import {} from "@scope/pkg";',
  );
  assertEquals(
    rewritePackageImport(
      'import {} from "../../mod.ts"; export {} from "../../mod.ts";',
      "/repository/readme/part/example.ts",
      imports,
    ),
    'import {} from "@scope/pkg"; export {} from "@scope/pkg";',
  );
  assertEquals(
    rewritePackageImport(
      'import "../../mod.ts";',
      "/repository/readme/part/example.ts",
      imports,
    ),
    'import "@scope/pkg";',
  );
  assertEquals(
    rewritePackageImport(
      'import {} from "../../other.ts";',
      "/repository/readme/part/example.ts",
      imports,
    ),
    'import {} from "../../other.ts";',
  );
  assertEquals(
    rewritePackageImport(
      'const source = "import {} from \\"../../mod.ts\\""; // from "../../mod.ts"',
      "/repository/readme/part/example.ts",
      imports,
    ),
    'const source = "import {} from \\"../../mod.ts\\""; // from "../../mod.ts"',
  );
});

test("does not resolve ambiguous or malformed Deno configs", async () => {
  const root = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-readme-",
  });
  try {
    await writeTextFile(
      `${root}/deno.json`,
      '{"name":"@scope/pkg","exports":"./mod.ts"}',
    );
    await writeTextFile(
      `${root}/deno.jsonc`,
      '{"name":"@scope/pkg","exports":"./mod.ts"}',
    );
    assertEquals((await packageImports(root)).size, 0);
    await remove(`${root}/deno.jsonc`);
    await writeTextFile(`${root}/deno.json`, "{");
    assertEquals((await packageImports(root)).size, 0);
  } finally {
    await remove(root, { recursive: true });
  }
});
