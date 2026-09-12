/** Idempotent GitHub Release publication. */
import { changelogHeadings } from "./changelog-markdown.ts";
import type { ReleaseEnvironment } from "./release-environment.ts";
import type { ReleaseProcess } from "./release-process.ts";
import { processText } from "./release-process.ts";
import {
  confirmPublication,
  type ReleaseClock,
} from "./confirm-publication.ts";
import { parseSemver } from "./semver.ts";
import {
  type PublisherFiles,
  publisherInput,
  versionConfig,
} from "./publisher-input.ts";

export type GithubRelease = {
  readonly tag_name: string;
  readonly target_commitish: string;
  readonly name: string;
  readonly body: string;
  readonly draft: boolean;
  readonly prerelease: boolean;
};
export type GithubReleaseApi = {
  read(tag: string): Promise<GithubRelease | undefined>;
  create(input: GithubRelease): Promise<void>;
};

export async function publishGithub(
  input: {
    environment: ReleaseEnvironment;
    process: ReleaseProcess;
    files: PublisherFiles;
    api: GithubReleaseApi;
    clock?: ReleaseClock;
  },
): Promise<void> {
  const release = await publisherInput(input.environment, input.process);
  await versionConfig(input.files, release.version);
  const text = await readChangelog(input.process);
  const expected: GithubRelease = {
    tag_name: release.tag,
    target_commitish: release.sha,
    name: release.version,
    body: changelogSection(text, release.version),
    draft: false,
    prerelease: parseSemver(release.version)!.prerelease.length > 0,
  };
  const existing = await input.api.read(release.tag);
  if (existing) return requireExact(existing, expected);
  try {
    await input.api.create(expected);
  } catch { /* Confirm an uncertain write without creating another release. */ }
  const confirmed = await confirmPublication(async () => {
    const after = await input.api.read(release.tag);
    if (!after) return false;
    requireExact(after, expected);
    return true;
  }, input.clock);
  if (!confirmed) throw new Error("GitHub Release creation was not confirmed.");
}

export function changelogSection(text: string, version: string): string {
  const headings = changelogHeadings(text).filter((heading) =>
    heading.level === 2
  );
  const matches = headings.flatMap((heading, index) =>
    heading.title === version
      ? [{ start: heading.offset, end: headings[index + 1]?.offset }]
      : []
  );
  if (matches.length !== 1) {
    throw new TypeError(
      "Applicable changelog section is missing or ambiguous.",
    );
  }
  return text.slice(matches[0].start, matches[0].end);
}
export function githubReleaseApi(
  process: ReleaseProcess,
  repository: string,
): GithubReleaseApi {
  if (!/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.test(repository)) {
    throw new TypeError("GitHub repository is invalid.");
  }
  return {
    async read(tag) {
      const result = await process.run("gh", [
        "api",
        "--paginate",
        "--slurp",
        `repos/${repository}/releases?per_page=100`,
      ]);
      if (!result.success) {
        throw new Error("GitHub Release lookup failed.");
      }
      // The tag endpoint omits drafts, including releases whose tag was deleted.
      let pages: unknown;
      try {
        pages = JSON.parse(processText(result));
      } catch {
        throw new TypeError("GitHub Release listing is not JSON.");
      }
      if (!Array.isArray(pages) || !pages.every(Array.isArray)) {
        throw new TypeError("GitHub Release listing is invalid.");
      }
      const matches = pages.flat().filter((value: unknown) => {
        if (
          !value || typeof value !== "object" ||
          !("tag_name" in value) || typeof value.tag_name !== "string"
        ) throw new TypeError("GitHub Release listing entry is invalid.");
        return value.tag_name === tag;
      });
      if (matches.length > 1) {
        throw new TypeError("Multiple GitHub Releases use this tag.");
      }
      return matches.length
        ? parseRelease(JSON.stringify(matches[0]))
        : undefined;
    },
    async create(input) {
      const result = await process.run("gh", [
        "api",
        "--include",
        `repos/${repository}/releases`,
        "--method",
        "POST",
        "--input",
        "-",
      ], { stdin: JSON.stringify(input) });
      const response = ghResponse(processText(result));
      if (!result.success || response.status !== 201) {
        throw new Error("GitHub Release creation failed.");
      }
      requireExact(parseRelease(response.body), input);
    },
  };
}

function ghResponse(text: string): { status: number; body: string } {
  const match =
    /^HTTP\/\d(?:\.\d)?\s+(\d{3})\b[^\n]*\r?\n[\s\S]*?\r?\n\r?\n([\s\S]*)$/
      .exec(text);
  if (!match) throw new TypeError("GitHub API response lacks an HTTP status.");
  return { status: Number(match[1]), body: match[2] };
}
function requireExact(actual: GithubRelease, expected: GithubRelease): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new TypeError(
      "Existing GitHub Release differs from expected release.",
    );
  }
}
function parseRelease(text: string): GithubRelease {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new TypeError("GitHub Release response is not JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("GitHub Release response is invalid.");
  }
  const x = value as Record<string, unknown>;
  if (
    typeof x.tag_name !== "string" || typeof x.target_commitish !== "string" ||
    typeof x.name !== "string" || typeof x.body !== "string" ||
    typeof x.draft !== "boolean" || typeof x.prerelease !== "boolean"
  ) throw new TypeError("GitHub Release response is invalid.");
  return {
    tag_name: x.tag_name,
    target_commitish: x.target_commitish,
    name: x.name,
    body: x.body,
    draft: x.draft,
    prerelease: x.prerelease,
  };
}
async function readChangelog(process: ReleaseProcess): Promise<string> {
  const result = await process.run("git", ["show", "HEAD:CHANGELOG.md"]);
  if (!result.success) throw new Error("CHANGELOG.md could not be read.");
  return processText(result);
}
