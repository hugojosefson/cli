/** Read-only Git history shared by release preparation and changelog migration. */
import type { ReleaseTag } from "./previous-release.ts";
import { type ReleaseProcess, runOrThrow } from "./release-process.ts";
const sha = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
export async function releaseTags(
  process: ReleaseProcess,
  selectedSha: string,
): Promise<readonly ReleaseTag[]> {
  const text = await runOrThrow(process, "git", [
    "for-each-ref",
    "--format=%(refname:strip=2)%00%(objecttype)%00%(objectname)%00%(*objectname)%00",
    "refs/tags",
  ]);
  const fields = text.split("\0");
  const tags: ReleaseTag[] = [];
  for (let index = 0; index + 3 < fields.length; index += 4) {
    const name = fields[index].replace(/^\n+/, "");
    const objectType = fields[index + 1];
    const objectName = fields[index + 2];
    const peeled = fields[index + 3];
    if (!name) continue;
    const target = objectType === "commit" ? objectName : peeled;
    if (!sha.test(target)) continue;
    const ancestor = await process.run("git", [
      "merge-base",
      "--is-ancestor",
      target,
      selectedSha,
    ]);
    if (ancestor.code !== 0 && ancestor.code !== 1) {
      throw new Error("Could not determine release-tag ancestry.");
    }
    tags.push({
      name,
      target,
      lightweight: objectType === "commit",
      targetIsAncestor: ancestor.code === 0,
    });
  }
  return tags;
}

export async function commitMessages(
  process: ReleaseProcess,
  commits: readonly string[],
): Promise<readonly string[]> {
  const messages: string[] = [];
  for (const commit of commits) {
    if (!sha.test(commit)) {
      throw new Error("Git returned an invalid commit SHA.");
    }
    messages.push((await runOrThrow(process, "git", [
      "show",
      "--no-patch",
      "--format=%B",
      commit,
    ])).replace(/\n+$/, ""));
  }
  return messages;
}
