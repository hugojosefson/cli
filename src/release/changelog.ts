/** @module Immutable changelog release-section creation and insertion. */

export type ChangelogInsertion = {
  readonly offset: number;
  readonly text: string;
};

const heading = "# Changelog";

/** Creates a deterministic release heading and list from validated commit subjects. */
export function createReleaseSection(
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
  if (
    !oldText.startsWith(heading) || !/^# Changelog(?:\r?\n|$)/.test(oldText)
  ) {
    throw new TypeError("Existing changelog must start with # Changelog.");
  }
  const section = /\n## [^\n]+(?:\r?\n|$)/.exec(oldText);
  const offset = section ? section.index + 1 : oldText.length;
  return { offset, text: releaseSection };
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
