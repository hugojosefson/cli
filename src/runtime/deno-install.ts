/** @module Atomic shared cache entries populated through the official npm Deno package. */
import * as fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { runRawCommand } from "./command.ts";
import { isNotFound } from "./errors.ts";

export interface CachedDeno {
  readonly path: string;
  readonly version: string;
}

export async function cachedDeno(
  directory: string,
  version: string,
): Promise<CachedDeno | undefined> {
  try {
    for (const path of [directory, join(directory, "bin")]) {
      const info = await fs.lstat(path);
      if (!info.isDirectory()) throw new Error("not a directory");
    }
    const manifest = join(directory, "manifest.json");
    const binary = join(directory, "bin/deno");
    if (
      !(await fs.lstat(manifest)).isFile() || !(await fs.lstat(binary)).isFile()
    ) throw new Error("not a regular file");
    const metadata = JSON.parse(await fs.readFile(manifest, "utf8"));
    if (
      metadata.schema !== 1 || metadata.version !== version ||
      metadata.platform !== "linux-x64-glibc" ||
      metadata.sha256 !== await binaryDigest(binary) ||
      ((await fs.stat(binary)).mode & 0o111) === 0
    ) {
      throw new Error("cache manifest or binary does not match");
    }
    return { path: binary, version };
  } catch (error) {
    if (isNotFound(error)) {
      try {
        await fs.lstat(directory);
      } catch (missing) {
        if (isNotFound(missing)) return undefined;
        throw missing;
      }
    }
    throw new Error(
      `Invalid Deno cache entry ${directory}. Remove that entry and retry.`,
      { cause: error },
    );
  }
}

async function binaryDigest(path: string): Promise<string> {
  return createHash("sha256").update(await fs.readFile(path)).digest("hex");
}

/** Package managers verify registry integrity; only the executable enters the cache. */
export async function installOfficialDeno(
  staging: string,
  version: string,
  manager: "npm" | "bun",
  signal?: AbortSignal,
  run: typeof runRawCommand = runRawCommand,
): Promise<void> {
  signal?.throwIfAborted();
  await fs.writeFile(
    join(staging, "package.json"),
    JSON.stringify({
      private: true,
      dependencies: { deno: version },
    }),
  );
  let result;
  try {
    result = await run(manager, {
      args: manager === "bun"
        ? ["install", "--cwd", staging, "--no-progress", "--ignore-scripts"]
        : [
          "install",
          "--prefix",
          staging,
          "--no-audit",
          "--no-fund",
          "--package-lock=false",
          "--ignore-scripts",
          "--include=optional",
        ],
      cwd: staging,
      stdin: "null",
      signal,
    });
  } catch (error) {
    if (isNotFound(error)) {
      throw new Error(
        `Automatic Deno acquisition needs ${manager} on PATH. Install ${manager} or provide a compatible Deno binary.`,
        { cause: error },
      );
    }
    throw error;
  }
  if (!result.success) {
    throw new Error(
      `Could not install official deno@${version} with ${manager} (exit ${result.code}). Check registry access and retry.`,
    );
  }
  signal?.throwIfAborted();
  await fs.mkdir(join(staging, "bin"), { mode: 0o700 });
  const require = createRequire(
    join(staging, "node_modules/deno/package.json"),
  );
  const platformPackage = require.resolve("@deno/linux-x64-glibc/package.json");
  await fs.copyFile(
    join(dirname(platformPackage), "deno"),
    join(staging, "bin/deno"),
  );
  await fs.chmod(join(staging, "bin/deno"), 0o755);
  await fs.rm(join(staging, "node_modules"), { recursive: true });
  for (const name of ["package.json", "bun.lock", "bun.lockb"]) {
    await fs.rm(join(staging, name), { force: true });
  }
}

const pending = new Map<string, Promise<CachedDeno>>();

/** Separate processes may stage concurrently; only one complete directory wins. */
export function acquireDeno(
  cache: string,
  version: string,
  install: (staging: string, version: string) => Promise<void>,
  verify: (path: string) => Promise<string | undefined>,
  signal?: AbortSignal,
): Promise<CachedDeno> {
  const directory = join(cache, version);
  if (signal) return acquire();
  const existing = pending.get(directory);
  if (existing) return existing;
  const operation = acquire();
  pending.set(directory, operation);
  operation.finally(() => pending.delete(directory)).catch(() => undefined);
  return operation;

  async function acquire(): Promise<CachedDeno> {
    signal?.throwIfAborted();
    await fs.mkdir(cache, { recursive: true, mode: 0o700 });
    const already = await cachedDeno(directory, version);
    if (already) return already;
    const staging = await fs.mkdtemp(join(cache, ".install-"));
    try {
      await install(staging, version);
      signal?.throwIfAborted();
      const binary = join(staging, "bin/deno");
      if (await verify(binary) !== version) {
        throw new Error(
          `Downloaded Deno does not report expected version ${version}.`,
        );
      }
      await fs.writeFile(
        join(staging, "manifest.json"),
        JSON.stringify({
          schema: 1,
          platform: "linux-x64-glibc",
          version,
          sha256: await binaryDigest(binary),
        }) + "\n",
      );
      signal?.throwIfAborted();
      try {
        await fs.rename(staging, directory);
      } catch (error) {
        if (
          !(error instanceof Error && "code" in error &&
            ["EEXIST", "ENOTEMPTY"].includes(String(error.code)))
        ) throw error;
      }
      return (await cachedDeno(directory, version))!;
    } finally {
      await fs.rm(staging, { recursive: true, force: true });
    }
  }
}
