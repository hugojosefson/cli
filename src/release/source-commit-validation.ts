/** @module Conventional Commit validation for a source pull request. */

import { validateConventionalCommits } from "./conventional-commit.ts";
import type { ReleaseProcess } from "./release-process.ts";
import { runOrThrow } from "./release-process.ts";

const gitSha = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

export async function validateSourceCommitRange(
  process: ReleaseProcess,
  baseSha: string,
  headSha: string,
): Promise<void> {
  if (!gitSha.test(baseSha) || !gitSha.test(headSha)) {
    throw new TypeError("Source base and head must be full Git SHAs.");
  }
  const mergeBase = singleLine(
    await runOrThrow(process, "git", ["merge-base", baseSha, headSha]),
  );
  if (!gitSha.test(mergeBase)) {
    throw new Error("Git returned an invalid merge-base SHA.");
  }
  const commits = lines(
    await runOrThrow(process, "git", [
      "rev-list",
      "--reverse",
      `${mergeBase}..${headSha}`,
    ]),
  );
  const messages: string[] = [];
  for (const commit of commits) {
    if (!gitSha.test(commit)) {
      throw new Error("Git returned an invalid commit SHA.");
    }
    const message = await runOrThrow(process, "git", [
      "show",
      "--no-patch",
      "--format=%B",
      commit,
    ]);
    messages.push(message.replace(/\n+$/, ""));
  }
  validateConventionalCommits(messages);
}

function lines(value: string): readonly string[] {
  return value.split("\n").filter((line) => line.length > 0);
}

function singleLine(value: string): string {
  const lines = value.trimEnd().split("\n");
  if (lines.length !== 1 || !lines[0]) {
    throw new Error("Git returned an ambiguous merge base.");
  }
  return lines[0];
}
