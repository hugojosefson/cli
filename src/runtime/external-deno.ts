/** @module On-demand Deno selection for genuine project tasks. */
import * as fs from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import process from "node:process";
import { compareSemver, parseSemver } from "../release/semver.ts";
import {
  type CommandOptions,
  type CommandResult,
  runRawCommand,
} from "./command.ts";
import {
  acceptsDeno,
  exactDenoVersion,
  projectDenoRequirement,
} from "./deno-requirement.ts";
import { currentDenoOptions, type DenoRuntimeOptions } from "./deno-options.ts";
import {
  acquireDeno,
  type CachedDeno,
  cachedDeno,
  installOfficialDeno,
} from "./deno-install.ts";
import { isNotFound } from "./errors.ts";

export interface DenoResolverHost {
  readonly path: string;
  readonly current?: CachedDeno;
  readonly cacheRoot: () => string;
  readonly assertPlatform: () => Promise<void>;
  readonly version: (path: string) => Promise<string | undefined>;
  readonly install: (staging: string, version: string) => Promise<void>;
  readonly report: (message: string) => void;
}

/** Resolve only when a Deno operation is about to run. */
export async function resolveExternalDeno(
  root: URL,
  options: DenoRuntimeOptions = {},
  host: DenoResolverHost = localDenoHost(),
): Promise<CachedDeno> {
  options.signal?.throwIfAborted();
  const requirement = await projectDenoRequirement(root, options);
  // A Deno-hosted CLI already has a verified installed runtime, without probing PATH.
  if (host.current && acceptsDeno(requirement, host.current.version)) {
    return host.current;
  }
  const seen = new Set<string>();
  for (const entry of host.path.split(delimiter).filter(Boolean)) {
    const binary = resolve(fileURLToPath(root), entry, "deno");
    if (seen.has(binary)) continue;
    seen.add(binary);
    try {
      const stat = await fs.stat(binary);
      if (!stat.isFile() || (stat.mode & 0o111) === 0) continue;
    } catch (error) {
      if (
        isNotFound(error) ||
        error instanceof Error && "code" in error &&
          ["EACCES", "ENOTDIR"].includes(String(error.code))
      ) continue;
      throw error;
    }
    const version = await host.version(binary);
    options.signal?.throwIfAborted();
    if (version && acceptsDeno(requirement, version)) {
      return { path: binary, version };
    }
  }
  options.signal?.throwIfAborted();
  await host.assertPlatform();
  const cache = join(host.cacheRoot(), "deno/linux-x64-glibc");
  let versions: string[] = [];
  try {
    versions = await fs.readdir(cache);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  versions = versions.filter((version) =>
    exactDenoVersion(version) && acceptsDeno(requirement, version)
  )
    .sort((a, b) => compareSemver(parseSemver(b)!, parseSemver(a)!));
  for (const version of versions) {
    const cached = await cachedDeno(join(cache, version), version);
    if (cached) {
      if (await host.version(cached.path) !== version) {
        throw new Error(
          `Cached Deno ${version} reports another version. Remove ${
            join(cache, version)
          } and retry.`,
        );
      }
      return cached;
    }
  }
  if (options.offline) {
    throw new Error(
      `No installed or cached Deno satisfies ${requirement.text}. Offline mode prevents downloading it.`,
    );
  }
  if (!requirement.preferred) {
    throw new Error(
      `No installed or cached Deno satisfies ${requirement.text}. Record an exact preferred version in .hj/deno-runtime.json or use --runtime-deno-preferred with --runtime-deno.`,
    );
  }
  options.signal?.throwIfAborted();
  host.report(
    `Downloading Deno ${requirement.preferred} for this project's Deno tasks.\n`,
  );
  return await acquireDeno(
    cache,
    requirement.preferred,
    host.install,
    host.version,
    options.signal,
  );
}

export async function runExternalDeno(
  options: CommandOptions,
): Promise<CommandResult> {
  const root = options.cwd instanceof URL
    ? options.cwd
    : pathToFileURL(resolve(options.cwd ?? process.cwd()) + "/");
  options.signal?.throwIfAborted();
  const host = localDenoHost(options.env?.PATH, options.signal);
  const selected = await resolveExternalDeno(root, {
    ...currentDenoOptions(),
    signal: options.signal,
  }, host);
  return await runRawCommand(selected.path, {
    ...options,
    env: {
      ...options.env,
      PATH: `${dirname(selected.path)}${delimiter}${host.path}`,
    },
  });
}

export function localDenoHost(
  path = process.env.PATH ?? "",
  signal?: AbortSignal,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  run: typeof runRawCommand = runRawCommand,
): DenoResolverHost {
  return {
    path,
    current: process.versions.deno
      ? { path: process.execPath, version: process.versions.deno }
      : undefined,
    cacheRoot: () => {
      const xdg = environment.XDG_CACHE_HOME;
      if (xdg) {
        if (!isAbsolute(xdg)) {
          throw new Error("XDG_CACHE_HOME must be an absolute directory.");
        }
        return join(xdg, "hj");
      }
      const home = environment.HOME;
      if (!home || !isAbsolute(home)) {
        throw new Error(
          "Set an absolute HOME or XDG_CACHE_HOME to cache Deno.",
        );
      }
      return join(home, ".cache/hj");
    },
    assertPlatform: () => {
      if (process.platform !== "linux" || process.arch !== "x64") {
        throw new Error(
          "Automatic Deno acquisition supports Linux x64 with glibc.",
        );
      }
      const glibc = process.versions.deno
        ? (globalThis as { Deno?: { build: { target: string } } }).Deno
          ?.build.target.endsWith("-linux-gnu")
        : !!(process.report.getReport() as {
          header?: { glibcVersionRuntime?: string };
        }).header?.glibcVersionRuntime;
      if (!glibc) {
        throw new Error(
          "Automatic Deno acquisition requires glibc; musl/Alpine is not supported.",
        );
      }
      return Promise.resolve();
    },
    version: async (binary) => {
      try {
        const result = await run(binary, {
          args: ["--version"],
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(5000)])
            : AbortSignal.timeout(5000),
        });
        const version = /^deno ([^\s]+)(?:\s|$)/.exec(
          new TextDecoder().decode(result.stdout),
        )?.[1];
        return result.success && version && exactDenoVersion(version)
          ? version
          : undefined;
      } catch (error) {
        signal?.throwIfAborted();
        if (
          isNotFound(error) ||
          error instanceof Error &&
            ["AbortError", "TimeoutError"].includes(error.name)
        ) return undefined;
        throw error;
      }
    },
    install: (staging, version) =>
      installOfficialDeno(
        staging,
        version,
        process.versions.bun ? "bun" : "npm",
        signal,
        run,
      ),
    report: (message) => {
      process.stderr.write(message);
    },
  };
}
