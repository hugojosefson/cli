import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { NativeGraph } from "./native-types.ts";
const execute = promisify(execFile);
type Edge = {
  isDynamic?: boolean;
  code?: { specifier?: string; error?: unknown };
};
type Graph = {
  modules: { specifier: string; error?: unknown; dependencies?: Edge[] }[];
};

export async function nativeGraph(
  root: URL,
  files: string[],
  deno: string,
): Promise<NativeGraph> {
  const emitted = new URL(".hj/test/esm/", root);
  const installed = new URL(".hj/test/node_modules/", root);
  const local = new Set<string>();
  const external = new Set<string>();
  for (const file of files) {
    const { stdout } = await execute(deno, [
      "info",
      "--json",
      "--no-config",
      "--no-lock",
      "--no-remote",
      "--deny-import",
      "--node-modules-dir=manual",
      fileURLToPath(new URL(file.replace(/\.ts$/, ".js"), emitted)),
    ], {
      cwd: root,
      maxBuffer: 16 * 1024 * 1024,
      env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", NO_COLOR: "1" },
    });
    const graph: Graph = JSON.parse(stdout);
    for (const module of graph.modules) {
      if (
        module.error || module.dependencies?.some((edge) => edge.code?.error)
      ) {
        throw new Error("Native import resolution did not succeed");
      }
      if (module.specifier.startsWith("node:")) {
        continue;
      }
      if (module.specifier.startsWith(installed.href)) {
        external.add(
          decodeURIComponent(module.specifier.slice(installed.href.length)),
        );
        continue;
      }
      if (!module.specifier.startsWith(emitted.href)) {
        throw new Error("Native import leaves the build directory");
      }
      const name = decodeURIComponent(
        module.specifier.slice(emitted.href.length),
      );
      local.add(name);
      const text = await readFile(new URL(module.specifier), "utf8");
      // An unaccounted import expression disables the observation.
      const expressions = [...text.matchAll(/\bimport\s*\(/g)].length;
      const resolved = module.dependencies?.filter((edge) =>
        edge.isDynamic && edge.code?.specifier
      ).length ?? 0;
      if (expressions > resolved) {
        throw new Error("Native import expression needs inspection");
      }
    }
  }
  return { files: [...local].sort(), external: [...external].sort() };
}
