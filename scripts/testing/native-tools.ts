import { execFile } from "node:child_process";
import { access, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, isAbsolute, resolve } from "node:path";
import { promisify } from "node:util";
import { nativeFile } from "./native-files.ts";
import type { NativeTool } from "./native-types.ts";
const execute = promisify(execFile);

export async function nativeExecutable(
  name: string,
  path: string,
): Promise<string> {
  const candidates = isAbsolute(name) ? [name] : path.split(delimiter)
    .filter((part) => isAbsolute(part)).map((part) => resolve(part, name));
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return await realpath(candidate);
    } catch { /* The next PATH directory can contain the executable. */ }
  }
  throw new Error("Native tool is unavailable");
}

export async function nativeTool(
  path: string,
  searchPath = "/usr/bin:/bin",
): Promise<NativeTool> {
  const file = await nativeFile(path);
  const { stdout } = await execute(path, ["--version"], {
    env: { PATH: searchPath, LANG: "C", LC_ALL: "C", NO_COLOR: "1" },
    timeout: 10000,
    maxBuffer: 4096,
  });
  return { path, file, version: stdout.trim() };
}

export async function nativeTools(
  executables: Record<string, string>,
  path: string,
): Promise<Record<string, NativeTool>> {
  const resolved = await Promise.all(
    Object.entries(executables).map(async (
      [name, executable],
    ) => [name, await nativeExecutable(executable, path)]),
  );
  const identities = new Map(
    await Promise.all([...new Set(resolved.map(([, executable]) => executable))]
      .map(async (executable) =>
        [executable, await nativeTool(executable, path)] as const
      )),
  );
  return Object.fromEntries(
    resolved.map(([name, executable]) => [name, identities.get(executable)!]),
  );
}
