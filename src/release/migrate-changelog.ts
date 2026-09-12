/** Read-only reconstruction of supported release sections from immutable Git ranges. */
import { changelogHeadings } from "./changelog-markdown.ts";
import { parse, type ParseError } from "jsonc-parser";
import {
  createLegacyReleaseSection,
  createReleaseSection,
} from "./changelog.ts";
import { formatChangelogSection } from "./format-changelog.ts";
import { commitMessages, releaseTags } from "./release-history.ts";
import { selectPreviousRelease } from "./previous-release.ts";
import { type ReleaseProcess, runOrThrow } from "./release-process.ts";
import { parseSemver } from "./semver.ts";

export async function migrateChangelog(
  oldText: string,
  repository: string,
  process: ReleaseProcess,
): Promise<string> {
  const headings = changelogHeadings(oldText).filter((heading) =>
    heading.level === 2
  );
  const tags = await releaseTags(process, "HEAD");
  const seen = new Set<string>();
  const replacements: { start: number; end: number; text: string }[] = [];
  for (const [index, heading] of headings.entries()) {
    const version = heading.title;
    if (!parseSemver(version)) continue;
    if (seen.has(version)) {
      throw new Error(`Duplicate changelog release ${version}.`);
    }
    seen.add(version);

    const tag = tags.find((tag) => tag.name === version);
    if (!tag?.lightweight || !tag.targetIsAncestor) {
      throw new Error(
        `Release ${version} needs its original lightweight ancestor tag; fetch the complete Git history and tags.`,
      );
    }
    const subject = (await runOrThrow(process, "git", [
      "show",
      "-s",
      "--format=%s",
      tag.target,
    ])).trimEnd();
    const parents = (await runOrThrow(process, "git", [
      "rev-list",
      "--parents",
      "-n",
      "1",
      tag.target,
    ])).trim().split(" ");
    if (subject !== `chore(release): ${version}` || parents.length !== 2) {
      throw new Error(
        `Release ${version} has no recognized single-parent release boundary.`,
      );
    }
    const parent = parents[1];
    const configs: string[] = [];
    for (const path of ["deno.json", "deno.jsonc"]) {
      const result = await process.run("git", ["show", `${parent}:${path}`]);
      if (result.success) configs.push(new TextDecoder().decode(result.stdout));
    }
    const errors: ParseError[] = [];
    const config = configs.length === 1
      ? parse(configs[0], errors, { allowTrailingComma: true })
      : undefined;
    if (!config || errors.length || typeof config.version !== "string") {
      throw new Error(
        `Release ${version} has no unambiguous previous version config.`,
      );
    }
    const previous = selectPreviousRelease(
      await releaseTags(process, parent),
      config.version,
    );
    if (previous.kind === "conflict" || previous.kind === "version-mismatch") {
      throw new Error(
        `Release ${version} has ambiguous previous release tags.`,
      );
    }
    const range = previous.kind === "tag"
      ? `${previous.tag.target}..${parent}`
      : parent;
    const ids =
      (await runOrThrow(process, "git", ["rev-list", "--reverse", range]))
        .trim().split("\n");
    const messages = await commitMessages(process, ids);
    const grouped = await formatChangelogSection(
      process,
      await createReleaseSection(
        version,
        ids.map((hash, i) => ({ hash, message: messages[i] })),
        repository,
      ),
    );
    const legacy = await formatChangelogSection(
      process,
      createLegacyReleaseSection(
        version,
        messages.map((message) => message.split("\n")[0]),
      ),
    );
    const start = heading.offset;
    const end = headings[index + 1]?.offset ?? oldText.length;
    const existing = oldText.slice(start, end);
    if (
      existing.trimEnd() !== legacy.trimEnd() &&
      existing.trimEnd() !== grouped.trimEnd()
    ) {
      throw new Error(
        `Release ${version} contains custom or mismatched text. Keep extending this changelog, or reconcile that section with Git history before migration.`,
      );
    }
    // Retain the section's exact separating whitespace and all non-release text.
    replacements.push({
      start,
      end,
      text: grouped.trimEnd() + existing.slice(existing.trimEnd().length),
    });
  }
  if (!seen.size) {
    throw new Error(
      "No supported release sections found. Keep extending this changelog; migration supports ## <SemVer> sections from hj releases.",
    );
  }
  let result = oldText;
  for (const replacement of replacements.reverse()) {
    result = result.slice(0, replacement.start) + replacement.text +
      result.slice(replacement.end);
  }
  return result;
}
