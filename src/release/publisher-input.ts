import { requiredEnvironment } from "./release-environment.ts";
/** Fail-closed common input and checkout validation for release publishers. */
import { parse, type ParseError } from "jsonc-parser";
import type { ReleaseEnvironment } from "./release-environment.ts";
import type { ReleaseProcess } from "./release-process.ts";
import { processText } from "./release-process.ts";
import { parseSemver } from "./semver.ts";

export type PublisherInput = {
  readonly route: "event" | "user";
  readonly repository: string;
  readonly tag: string;
  readonly version: string;
  readonly sha: string;
};
export type PublisherFiles = {
  observe(path: "deno.json" | "deno.jsonc"): Promise<
    | { readonly kind: "absent" }
    | { readonly kind: "other" }
    | { readonly kind: "file"; readonly bytes: Uint8Array }
  >;
};
const sha = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

export async function publisherInput(
  environment: ReleaseEnvironment,
  process: ReleaseProcess,
): Promise<PublisherInput> {
  const route = environment.get("HJ_RELEASE_ROUTE");
  const repository = environment.get("GITHUB_REPOSITORY");
  if (route !== "event" && route !== "user") {
    throw new TypeError("Release route is invalid.");
  }
  if (!repository || !githubRepository(repository)) {
    throw new TypeError("GitHub repository is invalid.");
  }
  const event = route === "event";
  if (event && environment.get("HJ_RELEASE_SCHEMA") !== "1") {
    throw new TypeError("Release event schema is invalid.");
  }
  const tag = requiredEnvironment(environment, "HJ_RELEASE_TAG");
  if (!parseSemver(tag)) {
    throw new TypeError("Release tag must be unprefixed SemVer.");
  }
  const version = event
    ? requiredEnvironment(environment, "HJ_RELEASE_VERSION")
    : tag;
  if (!parseSemver(version) || (event && version !== tag)) {
    throw new TypeError("Release version is invalid.");
  }
  const eventSha = event
    ? requiredEnvironment(environment, "HJ_RELEASE_SHA")
    : undefined;
  if (eventSha !== undefined && !sha.test(eventSha)) {
    throw new TypeError("Release event SHA is invalid.");
  }
  const remote = await lightweightTag(process, tag);
  const releaseSha = eventSha ?? remote;
  if (!sha.test(releaseSha) || remote !== releaseSha) {
    throw new TypeError("Release SHA differs from lightweight remote tag.");
  }
  const head = single(
    await run(process, "git", ["rev-parse", "HEAD^{commit}"]),
  );
  if (!sha.test(head) || head !== releaseSha) {
    throw new TypeError("Checkout HEAD differs from release SHA.");
  }
  return { route, repository, tag, version, sha: releaseSha };
}

export async function versionConfig(
  files: PublisherFiles,
  version: string,
): Promise<Record<string, unknown>> {
  const paths = ["deno.json", "deno.jsonc"] as const;
  const found = await Promise.all(paths.map((path) => files.observe(path)));
  if (found.some((entry) => entry.kind === "other")) {
    throw new TypeError("Deno config path is not a regular file.");
  }
  const selected = found.filter((entry) => entry.kind === "file");
  if (selected.length !== 1) {
    throw new TypeError("Exactly one regular Deno config is required.");
  }
  const text = new TextDecoder().decode(selected[0].bytes);
  const errors: ParseError[] = [];
  const config = parse(text, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (
    errors.length || !config || typeof config !== "object" ||
    Array.isArray(config) ||
    (config as { version?: unknown }).version !== version
  ) throw new TypeError("Deno config version differs from release version.");
  return config as Record<string, unknown>;
}

export function localPublisherFiles(root: URL): PublisherFiles {
  return {
    async observe(path) {
      try {
        const url = new URL(path, root);
        const info = await Deno.lstat(url);
        return info.isFile
          ? { kind: "file", bytes: await Deno.readFile(url) }
          : { kind: "other" };
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) return { kind: "absent" };
        throw error;
      }
    },
  };
}

async function lightweightTag(
  process: ReleaseProcess,
  tag: string,
): Promise<string> {
  const text = await run(process, "git", [
    "ls-remote",
    "origin",
    `refs/tags/${tag}`,
    `refs/tags/${tag}^{}`,
  ]);
  const match = /^([0-9a-f]{40}(?:[0-9a-f]{24})?)\trefs\/tags\/([^\s]+)\n$/
    .exec(
      text,
    );
  if (!match) {
    throw new TypeError("Remote tag is annotated, missing, or malformed.");
  }
  if (match[2] !== tag) {
    throw new TypeError("Remote tag name differs from the release tag.");
  }
  return match[1];
}

function githubRepository(value: string): boolean {
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(value);
  return !!match && match[1] !== "." && match[1] !== ".." &&
    match[2] !== "." && match[2] !== "..";
}
async function run(
  process: ReleaseProcess,
  command: string,
  args: readonly string[],
): Promise<string> {
  const result = await process.run(command, args);
  if (!result.success) throw new Error(`Release command failed: ${command}.`);
  return processText(result);
}
function single(text: string): string {
  const values = text.trim().split("\n");
  if (values.length !== 1 || !values[0]) {
    throw new TypeError("Git returned an ambiguous value.");
  }
  return values[0];
}
