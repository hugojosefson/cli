/** Read-only source digests for the observation pilot; never a cache loader. */
import { execFile } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  digest,
  focusedGroups,
  type InputSnapshot,
  observationSchema,
} from "./observation.ts";

const execute = promisify(execFile);
interface Graph {
  modules: { specifier: string; error?: unknown }[];
}

export function graphInputs(
  graph: Graph,
  root: URL,
): { paths: string[]; reasons: string[] } {
  const paths: string[] = [];
  const reasons: string[] = [];
  for (const module of graph.modules) {
    if (module.error) reasons.push(`Unresolved module: ${module.specifier}`);
    if (!module.specifier.startsWith("file:")) continue;
    if (!module.specifier.startsWith(root.href)) {
      reasons.push("Import outside the repository");
      continue;
    }
    paths.push(decodeURIComponent(module.specifier.slice(root.href.length)));
  }
  if (paths.includes("deno.json")) {
    reasons.push("Imports actual package metadata");
  }
  if (paths.includes("src/testing/runtime-test-fixtures.ts")) {
    reasons.push("Imports fixtures that execute the full CLI");
  }
  return { paths: [...new Set(paths)].sort(), reasons: [...new Set(reasons)] };
}

/** Omit only release version, and only when config is not imported as data. */
export function configurationInput(text: string): string {
  const config = JSON.parse(text);
  delete config.version;
  return digest(config);
}

export function inputSnapshot(
  files: string[],
  groupInputs: Record<string, Record<string, string>>,
  broadInputs: Record<string, string>,
  context: unknown,
  groupReasons: Record<string, string[]>,
): InputSnapshot {
  const ordered = (values: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(values).sort(([a], [b]) => a.localeCompare(b)),
    );
  broadInputs = ordered(broadInputs);
  const common = { schema: observationSchema, context };
  const groups = Object.fromEntries(focusedGroups.map(({ name, files }) => {
    const reasons = groupReasons[name] ?? [];
    const inputs = reasons.length ? broadInputs : ordered(groupInputs[name]);
    return [name, {
      inputs,
      key: digest({ ...common, files, inputs }),
      boundary: reasons.length ? "conservative" as const : "isolated" as const,
      reasons,
    }];
  }));
  return {
    schema: observationSchema,
    context: digest(context),
    files,
    groups,
    broadInputs,
    broadKey: digest({ ...common, files, inputs: broadInputs }),
  };
}

export async function captureInputs(
  root: URL,
  files: string[],
  denoExecutable: string,
  context: unknown,
  commandEnvironment?: Record<string, string>,
): Promise<InputSnapshot> {
  const { stdout } = await execute("git", [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
  ], { cwd: root, env: commandEnvironment, maxBuffer: 16 * 1024 * 1024 });
  const paths = [...new Set([...stdout.split("\0").filter(Boolean), ...files])]
    .sort();
  const broadInputs: Record<string, string> = {};
  for (const path of paths) {
    try {
      const info = await lstat(new URL(path, root));
      // Symlinked source needs an explicit audit before claiming narrow reuse.
      broadInputs[path] = digest({
        mode: info.mode & 0o777,
        content: (await readFile(new URL(path, root))).toString("base64"),
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      broadInputs[path] = "deleted";
    }
  }
  const { stdout: gitVersion } = await execute("git", ["--version"], {
    cwd: root,
    env: commandEnvironment,
  });
  const groupInputs: Record<string, Record<string, string>> = {};
  const groupReasons: Record<string, string[]> = {};
  await Promise.all(focusedGroups.map(async ({ name, files }) => {
    const closures = await Promise.all(files.map(async (file) => {
      const { stdout } = await execute(denoExecutable, [
        "info",
        "--json",
        "--frozen",
        "--config",
        fileURLToPath(new URL("deno.json", root)),
        fileURLToPath(new URL(file, root)),
      ], { cwd: root, env: commandEnvironment, maxBuffer: 16 * 1024 * 1024 });
      return graphInputs(JSON.parse(stdout), root);
    }));
    const reasons = [
      ...new Set(closures.flatMap((closure) => closure.reasons)),
    ];
    const inputPaths = new Set([
      ...closures.flatMap((closure) => closure.paths),
      "deno.lock",
      "toolchain.json",
      "scripts/run-tests.ts",
      ...paths.filter((path) => path.startsWith("scripts/testing/")),
    ]);
    const inputs: Record<string, string> = {};
    for (const path of [...inputPaths].sort()) {
      if (
        !Object.hasOwn(broadInputs, path) || broadInputs[path] === "deleted"
      ) {
        reasons.push(`Dependency outside the source inventory: ${path}`);
      } else {
        if ((await lstat(new URL(path, root))).isSymbolicLink()) {
          reasons.push(`Symlinked dependency: ${path}`);
        }
        inputs[path] = broadInputs[path];
      }
    }
    inputs["deno.json (except version)"] = digest({
      mode: (await lstat(new URL("deno.json", root))).mode & 0o777,
      configuration: configurationInput(
        await readFile(new URL("deno.json", root), "utf8"),
      ),
    });
    if (name === "release-core") inputs["tool:git"] = digest(gitVersion.trim());
    groupInputs[name] = inputs;
    groupReasons[name] = reasons;
  }));
  broadInputs["tool:git"] = digest(gitVersion.trim());
  return inputSnapshot(files, groupInputs, broadInputs, context, groupReasons);
}
