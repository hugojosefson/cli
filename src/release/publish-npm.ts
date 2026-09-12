/** Independent npm publication of a checked, reproducible build artifact. */
import type { ReleaseEnvironment } from "./release-environment.ts";
import {
  confirmPublication,
  type ReleaseClock,
} from "./confirm-publication.ts";
import {
  type PublisherFiles,
  publisherInput,
  versionConfig,
} from "./publisher-input.ts";
import { type ReleaseProcess, runOrThrow } from "./release-process.ts";
import { parseSemver } from "./semver.ts";

export const npmBuildDirectory = ".hj/npm/";
const registry = "https://registry.npmjs.org";
export type NpmVersion = {
  name: string;
  version: string;
  gitHead: string;
  integrity: string;
};
export type NpmApi = {
  version(name: string, version: string): Promise<NpmVersion | undefined>;
};
export type NpmBuildFiles = { read(path: string): Promise<string> };

/** Only a registry 404 means that publication may create a version. */
export function npmHttpApi(request: typeof fetch = fetch): NpmApi {
  return {
    async version(name, version) {
      const response = await request(
        `${registry}/${encodeURIComponent(name)}/${
          encodeURIComponent(version)
        }`,
        { signal: AbortSignal.timeout(15_000) },
      );
      if (response.status === 404) return undefined;
      if (response.status !== 200) {
        throw new Error("npm version lookup failed.");
      }
      const data = object(await response.json());
      const dist = object(data?.dist);
      if (
        data?.name !== name || data.version !== version ||
        typeof data.gitHead !== "string" || !integrity(dist?.integrity)
      ) {
        throw new TypeError("npm version metadata is invalid.");
      }
      return {
        name,
        version,
        gitHead: data.gitHead,
        integrity: dist.integrity as string,
      };
    },
  };
}

export function localNpmBuildFiles(root: URL): NpmBuildFiles {
  return {
    async read(path) {
      if (!safePath(path)) throw new TypeError("npm build path is invalid.");
      let url = new URL(npmBuildDirectory, root);
      // Never read through a symlink, including any parent of the build output.
      for (const part of [".hj", "npm"]) {
        const parent = new URL(part === ".hj" ? ".hj" : ".hj/npm", root);
        if (!(await Deno.lstat(parent)).isDirectory) {
          throw new TypeError("npm build parent is not a directory.");
        }
      }
      const parts = path.split("/");
      for (const [index, part] of parts.entries()) {
        url = new URL(part, url);
        const info = await Deno.lstat(url);
        if (index === parts.length - 1) {
          if (!info.isFile) {
            throw new TypeError("npm build entry is not a regular file.");
          }
        } else {
          if (!info.isDirectory) {
            throw new TypeError("npm build parent is not a directory.");
          }
          url = new URL(`${url.href}/`);
        }
      }
      return await Deno.readTextFile(url);
    },
  };
}

export async function publishNpm(input: {
  root: URL;
  environment: ReleaseEnvironment;
  process: ReleaseProcess;
  files: PublisherFiles;
  buildFiles: NpmBuildFiles;
  api: NpmApi;
  clock?: ReleaseClock;
}): Promise<void> {
  const release = await publisherInput(input.environment, input.process);
  if (
    (await runOrThrow(input.process, "git", [
      "status",
      "--porcelain=v1",
      "--untracked-files=normal",
    ])).trim()
  ) {
    throw new TypeError("npm publication requires a clean release checkout.");
  }
  const config = await versionConfig(input.files, release.version);
  if (
    typeof config.name !== "string" ||
    !/^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(config.name)
  ) {
    throw new TypeError(
      "npm publication requires a scoped package name in Deno config.",
    );
  }
  const tasks = object(config.tasks);
  if (!tasks?.["npm-build"]) {
    throw new TypeError(
      "Define an npm-build Deno task that creates .hj/npm/package.json.",
    );
  }
  await runOrThrow(input.process, "deno", ["task", "npm-build"], {
    env: {
      HJ_RELEASE_SHA: release.sha,
      HJ_RELEASE_VERSION: release.version,
      HJ_RELEASE_REPOSITORY: release.repository,
    },
  });
  await runOrThrow(input.process, "git", ["diff", "--exit-code", "HEAD", "--"]);
  const manifest = object(
    JSON.parse(await input.buildFiles.read("package.json")),
  );
  if (
    manifest?.name !== config.name || manifest.version !== release.version ||
    manifest.gitHead !== release.sha || manifest.private === true
  ) {
    throw new TypeError(
      "npm build name, version, or gitHead differs from the release, or the package is private.",
    );
  }
  const publishConfig = object(manifest.publishConfig);
  if (
    publishConfig &&
    (Object.keys(publishConfig).some((key) =>
      !["registry", "access"].includes(key)
    ) ||
      (publishConfig.registry !== undefined &&
          publishConfig.registry !== registry + "/" &&
          publishConfig.registry !== registry ||
        publishConfig.access !== undefined &&
          publishConfig.access !== "public"))
  ) {
    throw new TypeError("npm build must target the public npm registry.");
  }
  const entries = entryPoints(manifest);
  for (const entry of entries) await input.buildFiles.read(entry);
  const cwd = new URL(npmBuildDirectory, input.root);
  const packed: unknown = JSON.parse(
    await runOrThrow(input.process, "npm", [
      "pack",
      "--json",
      "--ignore-scripts",
    ], { cwd }),
  );
  const packResults = Array.isArray(packed)
    ? packed
    : object(packed)
    ? Object.values(object(packed)!)
    : [];
  const pack = packResults.length === 1 ? object(packResults[0]) : undefined;
  if (
    !pack || pack.name !== config.name || pack.version !== release.version ||
    !integrity(pack.integrity) || typeof pack.filename !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.tgz$/.test(pack.filename)
  ) {
    throw new TypeError("npm pack returned invalid package metadata.");
  }
  const packedFiles = Array.isArray(pack.files)
    ? pack.files.map((entry) => object(entry)?.path)
    : [];
  if (
    !["package.json", ...entries].every((path) => packedFiles.includes(path))
  ) throw new TypeError("npm archive omits a declared entry point.");
  const expected: NpmVersion = {
    name: config.name,
    version: release.version,
    gitHead: release.sha,
    integrity: pack.integrity as string,
  };
  const verify = (actual: NpmVersion) => {
    if (
      actual.name !== expected.name || actual.version !== expected.version ||
      actual.gitHead !== expected.gitHead ||
      actual.integrity !== expected.integrity
    ) {
      throw new TypeError(
        "Existing npm version differs from the release build. Never overwrite a published version.",
      );
    }
  };
  const existing = await input.api.version(expected.name, expected.version);
  if (existing) return verify(existing);
  const tag = parseSemver(release.version)!.prerelease.length
    ? "next"
    : "latest";
  try {
    await runOrThrow(input.process, "npm", [
      "publish",
      pack.filename,
      "--ignore-scripts",
      "--access=public",
      `--registry=${registry}/`,
      `--tag=${tag}`,
    ], { cwd });
  } catch {
    /* Confirm uncertain publication; do not upload twice in one run. */
  }
  const confirmed = await confirmPublication(async () => {
    const actual = await input.api.version(expected.name, expected.version);
    if (!actual) return false;
    verify(actual);
    return true;
  }, input.clock);
  if (!confirmed) {
    throw new Error(
      "npm publication was not confirmed. Check npm authentication and retry this workflow with the same release tag.",
    );
  }
}

function entryPoints(manifest: Record<string, unknown>): string[] {
  const entries: unknown[] = [];
  if (typeof manifest.bin === "string") entries.push(manifest.bin);
  else if (object(manifest.bin)) {
    entries.push(...Object.values(object(manifest.bin)!));
  }
  if (typeof manifest.main === "string") entries.push(manifest.main);
  if (
    !entries.length ||
    entries.some((path) =>
      typeof path !== "string" || !safePath(path.replace(/^\.\//, ""))
    )
  ) {
    throw new TypeError("npm build requires safe bin or main entry points.");
  }
  return entries.map((path) => (path as string).replace(/^\.\//, ""));
}
function safePath(path: string): boolean {
  return /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(path) &&
    !path.split("/").some((part) => part === "." || part === "..");
}
function integrity(value: unknown): value is string {
  return typeof value === "string" &&
    /^sha512-[A-Za-z0-9+/]{86}==$/.test(value);
}
function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
