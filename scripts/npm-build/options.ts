import type { BuildOptions } from "@deno/dnt";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The production emitter configuration; test emission may reuse its mappings. */
export function nativeBuildOptions(
  root: URL,
  outDir: URL,
  metadata: BuildOptions["package"],
): BuildOptions {
  const manifest = JSON.parse(
    readFileSync(
      new URL("scripts/npm-build/dependencies/package.json", root),
      "utf8",
    ),
  );
  return {
    entryPoints: [{
      kind: "bin",
      name: "hj",
      path: fileURLToPath(new URL("src/cli/cli.ts", root)),
    }],
    importMap: fileURLToPath(new URL("deno.json", root)),
    outDir: fileURLToPath(outDir),
    shims: {},
    test: false,
    typeCheck: "single",
    declaration: false,
    scriptModule: false,
    skipNpmInstall: true,
    skipSourceOutput: true,
    compilerOptions: { target: "ES2023", sourceMap: false },
    mappings: {
      "jsr:@std/path": {
        name: "@jsr/std__path",
        version: manifest.dependencies["@jsr/std__path"],
      },
    },
    package: metadata,
  };
}
