import type { BuildOptions } from "@deno/dnt";
import { fileURLToPath } from "node:url";

/** The production emitter configuration; test emission may reuse its mappings. */
export function nativeBuildOptions(
  root: URL,
  outDir: URL,
  metadata: BuildOptions["package"],
): BuildOptions {
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
      "jsr:@std/path": { name: "@jsr/std__path", version: "1.1.6" },
    },
    package: metadata,
  };
}
