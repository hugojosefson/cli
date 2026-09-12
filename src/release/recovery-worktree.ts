/** @module Isolated temporary-index and restoration operations for recovery. */
import * as fs from "node:fs/promises";

import { digestBytes } from "../repository/digest-bytes.ts";
import type { ReleaseProcess } from "./release-process.ts";
import { runOrThrow } from "./release-process.ts";
import { makeReleaseTempDir } from "./release-temp.ts";

export async function releaseTreeIndexDigest(
  process: ReleaseProcess,
  tree: string,
): Promise<string> {
  const directory = await makeReleaseTempDir("hj-release-tree-");
  try {
    const env = { GIT_INDEX_FILE: `${directory}/index` };
    await runOrThrow(process, "git", ["read-tree", tree], { env });
    const staged = await process.run("git", [
      "ls-files",
      "--stage",
      "-z",
    ], { env });
    if (!staged.success) {
      throw new Error("Could not read the release tree index.");
    }
    return await digestBytes(staged.stdout);
  } finally {
    await fs.rm(directory, { recursive: true });
  }
}

export async function restoreRecoveryWorktree(
  process: ReleaseProcess,
  selected: string,
  generatedPath: string,
): Promise<void> {
  await runOrThrow(process, "git", ["reset", "--hard", selected]);
  await runOrThrow(process, "git", ["clean", "-f", "--", generatedPath]);
}
