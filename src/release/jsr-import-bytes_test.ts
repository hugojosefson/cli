import { test as nativeTest } from "node:test";
import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
import { jsrImportBytes } from "./jsr-import-bytes.ts";
import { jsrImportMap } from "./jsr-import-map.ts";
import { digestBytes } from "../repository/digest-bytes.ts";
import { publishJsr } from "./publish-jsr.ts";
import {
  encoder,
  environment,
  files,
  process,
  remote,
} from "./publisher-test-fixtures.ts";

const test = trackTests(import.meta.url, nativeTest);
const config = {
  name: "@owner/repo",
  version: "1.2.3",
  exports: "./mod.ts",
  imports: {
    "@std/assert": "jsr:@std/assert@^1.0.19",
    "@std/cli": "jsr:@std/cli@^1.0.17",
    local: "./src/local.ts",
  },
};
const reader = { read: () => Promise.resolve(encoder.encode("x")) };
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

test("JSR import transformation preserves source outside import literals", async () => {
  const source = [
    '// import { assertEquals } from "@std/assert";',
    "const text = 'import \"@std/assert\";';",
    String.raw`const pattern = /import "@std\/assert"/;`,
    'import { assertEquals } from "@std/assert";',
    'import type { Args } from "@std/cli/parse-args";',
    'export { parseArgs } from "@std/cli/parse-args";',
    'export * from "local";',
    'await import("@std/assert");',
    'await import("@std/assert");',
    "await import(`./${name}.ts`);",
  ].join("\r\n");
  const expected = source.split("\r\n").map((line, index) =>
    index < 3 ? line : line
      .replaceAll('"@std/assert"', '"jsr:@std/assert@^1.0.19"')
      .replaceAll('"@std/cli/parse-args"', '"jsr:/@std/cli@^1.0.17/parse-args"')
      .replace('"local"', '"./local.ts"')
  ).join("\r\n");
  assertEquals(
    decode(
      await jsrImportBytes(
        encoder.encode(source),
        "src/check.test.ts",
        await jsrImportMap(config, reader),
      ),
    ),
    expected,
  );
  assertEquals(
    decode(
      await jsrImportBytes(
        encoder.encode(source),
        "README.md",
        await jsrImportMap(config, reader),
      ),
    ),
    source,
  );
});

test("JSR import maps preserve scope priority and external map locations", async () => {
  const map = await jsrImportMap({ importMap: "config/import-map.json" }, {
    read: (path) => {
      assertEquals(path, "config/import-map.json");
      return Promise.resolve(encoder.encode(JSON.stringify({
        imports: {
          local: "../src/local.ts",
          "lib/": "https://example.org/lib/",
        },
        scopes: {
          "../src/": { lib: "npm:library@1" },
          "../src/deep/": { lib: "npm:library@2" },
        },
      })));
    },
  });
  assertEquals(map("local", "src/deep/file.ts"), "../local.ts");
  assertEquals(map("lib", "src/deep/file.ts"), "npm:library@2");
  assertEquals(map("lib", "src/file.ts"), "npm:library@1");
  assertEquals(
    map("lib/file.ts", "file.ts"),
    "https://example.org/lib/file.ts",
  );
  assertEquals(map("unmapped", "file.ts"), "unmapped");
  const bounded = await jsrImportMap({
    imports: { encoded: "npm:pkg@%5E1", blocked: null },
  }, reader);
  assertEquals(bounded("encoded/file", "file.ts"), "npm:/pkg@%5E1/file");
  assertThrows(() => bounded("encoded/%2e%2e/other", "file.ts"), TypeError);
  assertThrows(() => bounded("blocked", "file.ts"), TypeError);
  await assertRejects(() => jsrImportMap({ importMap: "../map.json" }, reader));
  await assertRejects(() => jsrImportMap({ importMap: "map.json" }, reader));
});

test("JSR accepts transformed unexported modules and rejects other byte changes", async () => {
  const source =
    'import { assertEquals } from "@std/assert";\nassertEquals(1, 1);\n';
  const expected = source.replace("@std/assert", "jsr:@std/assert@^1.0.19");
  const manifestFile = async (text: string) => ({
    size: encoder.encode(text).length,
    checksum: `sha256-${await digestBytes(encoder.encode(text))}`,
  });
  let provenanceCalls = 0;
  const options = {
    environment: environment(),
    process: process([]),
    files: files(JSON.stringify(config)),
    packageFiles: {
      read: (path: string) =>
        Promise.resolve(
          encoder.encode(path === "src/hello.test.ts" ? source : "x"),
        ),
    },
  };
  const publish = async (text: string) => {
    const version = {
      ...remote(),
      manifest: {
        ...remote().manifest,
        "/src/hello.test.ts": await manifestFile(text),
      },
    };
    await publishJsr({
      ...options,
      api: {
        version: () => Promise.resolve(version),
        verifyProvenance: () => {
          provenanceCalls++;
          return Promise.resolve();
        },
      },
    });
  };
  await publish(source);
  await publish(expected);
  assertEquals(provenanceCalls, 2);
  for (
    const text of [
      expected.replace("1, 1", "1, 2"),
      expected.replace("^1.0.19", "^2.0.0"),
      expected + "// change\n",
      source.replace("assertEquals(1, 1)", "assertEquals(2, 2)"),
    ]
  ) {
    await assertRejects(() => publish(text), TypeError, "content differs");
  }
  assertEquals(provenanceCalls, 2);
  await assertRejects(
    () =>
      publishJsr({
        ...options,
        api: {
          version: async () => ({
            ...remote(),
            manifest: {
              ...remote().manifest,
              "/src/hello.test.ts": await manifestFile(expected),
            },
          }),
          verifyProvenance: () =>
            Promise.reject(new TypeError("provenance differs")),
        },
      }),
    TypeError,
    "provenance differs",
  );
});
