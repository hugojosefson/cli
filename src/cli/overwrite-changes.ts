/** @module Guarded changes from projected overwrite artifacts. */
import * as fs from "node:fs/promises";
import type { PlannedChange } from "../api/planned-change.ts";
import type { RepositoryRoot } from "../repository/repository-path.ts";
import { repositoryUrl } from "../repository/repository-path.ts";
import { LocalFileReader } from "../repository/local-file-reader.ts";
import type { OverwriteFiles } from "./overwrite-files.ts";
import { sameArtifact } from "./overwrite-artifact-state.ts";

export async function compileOverwriteChanges(
  root: RepositoryRoot,
  files: OverwriteFiles,
): Promise<readonly PlannedChange[]> {
  const result: PlannedChange[] = [];
  for (
    const [path, desired] of [...files.changed].sort(([a], [b]) =>
      a.split("/").length - b.split("/").length || a.localeCompare(b)
    )
  ) {
    const current = await files.initial(path);
    if (sameArtifact(current, desired)) continue;
    if (current.kind === "unreadable") {
      throw new Error(`Cannot read ${path}: ${current.observation}`);
    }
    if (desired.kind === "file" && current.kind === "file") {
      const writing = current.content !== desired.content;
      const unlocked = writing ? current.mode | 0o200 : current.mode;
      if (unlocked !== current.mode) {
        result.push({
          kind: "set-file-mode",
          path,
          mode: unlocked,
          expectedMode: current.mode,
        });
      }
      if (writing) {
        result.push({
          kind: "write-file",
          path,
          content: desired.content,
          expectedDigest: current.digest,
        });
      }
      if (unlocked !== desired.mode) {
        result.push({
          kind: "set-file-mode",
          path,
          mode: desired.mode,
          expectedMode: unlocked,
        });
      }
      continue;
    }
    if (current.kind === "file") {
      result.push({
        kind: "remove-file",
        path,
        expectedDigest: current.digest,
      });
    }
    if (current.kind === "symlink") {
      result.push({
        kind: "remove-symlink",
        path,
        expectedTarget: current.target,
      });
    }
    if (current.kind === "directory" && desired.kind !== "directory") {
      result.push({
        kind: "remove-directory",
        path,
        expectedStateDigest: await removalDigest(root, path),
      });
    }
    if (desired.kind === "directory" && current.kind !== "directory") {
      result.push({ kind: "create-directory", path });
    }
    if (desired.kind === "file") {
      result.push({
        kind: "write-file",
        path,
        content: desired.content,
        mode: desired.mode,
        expectedDigest: undefined,
      });
    }
  }
  return result;
}

async function removalDigest(
  root: RepositoryRoot,
  path: string,
): Promise<string> {
  await rejectGitMetadata(repositoryUrl(root, path));
  return (await new LocalFileReader(root.url).directoryStateDigest(path))!;
}
async function rejectGitMetadata(directory: URL): Promise<void> {
  const root = new URL(
    directory.href.endsWith("/") ? directory.href : `${directory.href}/`,
  );
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (entry.name.toLowerCase() === ".git") {
      throw new Error(
        "--overwrite cannot remove a directory with Git metadata.",
      );
    }
    if (entry.isDirectory()) {
      await rejectGitMetadata(
        new URL(`${encodeURIComponent(entry.name)}/`, root),
      );
    }
  }
}
