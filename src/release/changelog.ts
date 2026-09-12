/** @module Immutable changelog release-section creation and insertion. */

import { changelogHeadings } from "./changelog-markdown.ts";
import { CommitParser } from "conventional-commits-parser";
import { writeChangelogString } from "conventional-changelog-writer";
import { validateConventionalCommits } from "./conventional-commit.ts";
import { parseSemver } from "./semver.ts";

export type ChangelogCommit = {
  readonly hash: string;
  readonly message: string;
};

const sections = ["BREAKING CHANGE", "Features", "Fixes", "Other"];

/** Validates the target used for commit and issue links. */
export function changelogRepositoryUrl(repository: string): string {
  const parts = repository.split("/");
  if (
    parts.length !== 2 ||
    parts.some((part) =>
      !/^[A-Za-z0-9_.-]+$/.test(part) || part === "." || part === ".."
    )
  ) throw new TypeError("Changelog requires a GitHub owner/repository.");
  return `https://github.com/${repository}`;
}

/** Groups validated full messages with the pinned Conventional Changelog libraries. */
export async function createReleaseSection(
  version: string,
  commits: readonly ChangelogCommit[],
  repository: string,
): Promise<string> {
  const repositoryUrl = changelogRepositoryUrl(repository);
  if (
    !parseSemver(version) || commits.length === 0 ||
    commits.some((commit) =>
      !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(commit.hash)
    )
  ) {
    throw new TypeError(
      "Release section requires a version and full commit SHAs.",
    );
  }
  const validated = validateConventionalCommits(
    commits.map((commit) => commit.message),
  );
  const parser = new CommitParser({
    headerPattern: /^([a-z][a-z0-9-]*)(?:\(([\w./@ -]+)\))?!?: (.+)$/,
    headerCorrespondence: ["type", "scope", "subject"],
    noteKeywords: ["BREAKING CHANGE", "BREAKING-CHANGE"],
  });
  const parsed = commits.map((commit, index) => {
    const data = parser.parse(commit.message);
    const references = [
      ...data.references,
      ...data.notes.flatMap((note) =>
        parser.parse(`fix: note\n\n${note.text}`).references
      ),
    ];
    const refs = new Map<string, string>();
    for (const reference of references) {
      if (!/^\d+$/.test(reference.issue)) continue;
      const target = reference.repository
        ? `${
          reference.owner ?? repository.split("/")[0]
        }/${reference.repository}`
        : repository;
      const label = `${reference.owner ? `${reference.owner}/` : ""}${
        reference.repository ?? ""
      }#${reference.issue}`;
      refs.set(
        label,
        `${changelogRepositoryUrl(target)}/issues/${reference.issue}`,
      );
    }
    const used = new Set<string>();
    const subject = linkReferences(data.subject ?? "", refs, used);
    const notes = data.notes.map((note) => ({
      ...note,
      text: linkReferences(note.text, refs, used),
    }));
    const extraLinks = [...refs].flatMap(([label, url]) => {
      if (used.has(url)) return [];
      used.add(url);
      return [`[${label}](${url})`];
    });
    return {
      ...data,
      hash: commit.hash,
      scope: data.scope ?? "",
      subject,
      notes,
      type: validated[index].breaking
        ? "BREAKING CHANGE"
        : data.type === "feat"
        ? "Features"
        : data.type === "fix"
        ? "Fixes"
        : "Other",
      links: [
        `[${commit.hash.slice(0, 7)}](${repositoryUrl}/commit/${commit.hash})`,
        ...extraLinks,
      ],
    };
  });
  const text = await writeChangelogString(parsed, { version }, {
    // Preserve full hashes, every commit type, and the supplied range order.
    transform: (commit) => commit,
    ignoreReverted: false,
    generateOn: () => false,
    groupBy: "type",
    commitsSort: (a, b) => compare(a.scope, b.scope),
    commitGroupsSort: (a, b) =>
      sections.indexOf(a.title) - sections.indexOf(b.title),
    template: (context) => {
      let output = `## ${version}\n\n`;
      for (const group of context.commitGroups ?? []) {
        output += `### ${group.title}\n\n`;
        let scope: string | undefined;
        for (const commit of group.commits) {
          if (commit.scope !== scope) {
            if (scope !== undefined) output += "\n";
            scope = commit.scope;
            if (scope) output += `#### ${scope}\n\n`;
          }
          output += `- ${commit.subject} (${commit.links.join(", ")})\n`;
          for (const note of commit.notes) {
            output += `\n  ${note.text.replaceAll("\n", "\n  ")}\n`;
          }
        }
        output += "\n";
      }
      return output;
    },
  });
  return `${text.trimEnd()}\n\n`;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export type ChangelogInsertion = {
  readonly offset: number;
  readonly text: string;
};

const heading = "# Changelog";

/** Creates a deterministic release heading and list from validated commit subjects. */
export function createLegacyReleaseSection(
  version: string,
  subjects: readonly string[],
): string {
  if (!version || subjects.some((subject) => !subject)) {
    throw new TypeError(
      "Release section requires a version and non-empty subjects.",
    );
  }
  return `## ${version}\n\n${
    subjects.map((subject) => `- ${subject}`).join("\n")
  }\n\n`;
}

/** Finds the insertion immediately before the first existing release section. */
export function createChangelogInsertion(
  oldText: string,
  releaseSection: string,
): ChangelogInsertion {
  if (!releaseSection || !releaseSection.endsWith("\n\n")) {
    throw new TypeError("Release section must end with two newlines.");
  }
  if (!oldText) {
    return { offset: 0, text: `${heading}\n\n${releaseSection}` };
  }
  const allHeadings = changelogHeadings(oldText);
  const headings = allHeadings.filter((item) => item.level === 2);
  const section =
    headings.find((item) =>
      parseSemver(item.title) || /^\[?unreleased\]?$/i.test(item.title)
    ) ?? headings[0];
  // Without release headings, insert just after a leading title. Never enter a code block.
  const titleEnd = allHeadings[0]?.level === 1 && allHeadings[0]?.offset === 0
    ? /^(?:[^\n]*\n)(?:[ \t]*\r?\n)*/.exec(oldText)?.[0].length ??
      oldText.length
    : 0;
  const offset = section?.offset ?? titleEnd;
  const prefix = oldText.slice(0, offset);
  const separator = !prefix || prefix.endsWith("\n\n")
    ? ""
    : prefix.endsWith("\n")
    ? "\n"
    : "\n\n";
  return { offset, text: separator + releaseSection };
}

/** Applies the recorded insertion and leaves every old byte outside it unchanged. */
export function applyChangelogInsertion(
  oldText: string,
  insertion: ChangelogInsertion,
): string {
  if (
    !Number.isSafeInteger(insertion.offset) || insertion.offset < 0 ||
    insertion.offset > oldText.length
  ) {
    throw new TypeError(
      "Changelog insertion offset is outside the source text.",
    );
  }
  return oldText.slice(0, insertion.offset) + insertion.text +
    oldText.slice(insertion.offset);
}

/** Leave existing Markdown links, code and URLs intact while linking plain references. */
function linkReferences(
  text: string,
  references: ReadonlyMap<string, string>,
  used: Set<string>,
): string {
  return text.replace(
    /\[[^\]]*\]\([^)]*\)|`[^`]*`|https?:\/\/\S+|(?<![\w/])(?:[\w.-]+(?:\/[\w.-]+)?)?#\d+\b/g,
    (token) => {
      const url = references.get(token);
      if (!url) {
        for (const target of references.values()) {
          if (token.endsWith(`](${target})`)) used.add(target);
        }
        return token;
      }
      used.add(url);
      return `[${token}](${url})`;
    },
  );
}

/** The original insertion algorithm remains frozen for exact legacy recovery. */
export function createLegacyChangelogInsertion(
  oldText: string,
  releaseSection: string,
): ChangelogInsertion {
  if (!oldText) return { offset: 0, text: `${heading}\n\n${releaseSection}` };
  if (!/^# Changelog(?:\r?\n|$)/.test(oldText)) {
    throw new TypeError("Existing changelog must start with # Changelog.");
  }
  const section = /\n## [^\n]+(?:\r?\n|$)/.exec(oldText);
  return {
    offset: section ? section.index + 1 : oldText.length,
    text: releaseSection,
  };
}
