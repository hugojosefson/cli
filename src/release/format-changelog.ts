/** Format new changelog text without rewriting previous content. */
import {
  type ChangelogInsertion,
  createChangelogInsertion,
} from "./changelog.ts";
import { type ReleaseProcess, runOrThrow } from "./release-process.ts";

export async function formatChangelogSection(
  process: ReleaseProcess,
  section: string,
): Promise<string> {
  return await runOrThrow(process, "deno", ["fmt", "--ext=md", "-"], {
    stdin: section,
  });
}

export async function formatChangelogInsertion(
  process: ReleaseProcess,
  oldText: string,
  section: string,
): Promise<ChangelogInsertion> {
  const formatted = await formatChangelogSection(process, section);
  const insertion = createChangelogInsertion(
    oldText,
    `${formatted.trimEnd()}\n\n`,
  );
  return insertion.offset === oldText.length
    ? { ...insertion, text: `${insertion.text.trimEnd()}\n` }
    : insertion;
}
