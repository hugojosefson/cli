/** Explicit changelog migration with a read-only default and guarded application. */
import * as fs from "node:fs/promises";
import { changelogRepositoryUrl } from "../release/changelog.ts";
import { migrateChangelog } from "../release/migrate-changelog.ts";
import {
  localReleaseProcess,
  type ReleaseProcess,
  runOrThrow,
} from "../release/release-process.ts";

export function parseChangelogMigration(
  args: readonly string[],
): { write: boolean; repository?: string } {
  let write = false;
  let repository: string | undefined;
  for (const arg of args) {
    if (arg === "--write" && !write) write = true;
    else if (arg.startsWith("--repository=") && repository === undefined) {
      repository = arg.slice("--repository=".length);
      changelogRepositoryUrl(repository);
    } else {throw new Error(
        "expected `hj changelog migrate [--write] [--repository=owner/repo]`",
      );}
  }
  return { write, repository };
}

export async function runChangelogMigration(
  root: URL,
  options: ReturnType<typeof parseChangelogMigration>,
  process: ReleaseProcess = localReleaseProcess(root),
): Promise<string> {
  const path = new URL("CHANGELOG.md", root);
  if (!(await fs.lstat(path)).isFile()) {
    throw new Error("CHANGELOG.md must be a regular file.");
  }
  const oldText = await fs.readFile(path, "utf8");
  let repository = options.repository;
  if (!repository) {
    const origin =
      (await runOrThrow(process, "git", ["remote", "get-url", "origin"]))
        .trim();
    const match =
      /^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?$/
        .exec(origin);
    if (!match) {
      throw new Error(
        "Use --repository=owner/repo or set origin to its GitHub repository.",
      );
    }
    repository = match[1];
  }
  const nextText = await migrateChangelog(oldText, repository, process);
  if (!options.write) return nextText;
  if (
    !(await fs.lstat(path)).isFile() ||
    await fs.readFile(path, "utf8") !== oldText
  ) {
    throw new Error("CHANGELOG.md changed during migration; preview it again.");
  }
  if (nextText === oldText) {
    return "CHANGELOG.md already uses grouped release sections.\n";
  }
  await fs.writeFile(path, nextText);
  return "Migrated CHANGELOG.md. Review the diff before committing.\n";
}
