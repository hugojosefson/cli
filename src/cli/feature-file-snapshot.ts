/** @module File snapshots for attributing feature changes without staging user files. */
import { runCommand } from "../runtime/command.ts";
import { isNotFound } from "../runtime/errors.ts";
import * as fs from "node:fs/promises";
import {
  repositoryRoot,
  repositoryUrl,
} from "../repository/repository-path.ts";

export interface FileVersion {
  readonly bytes: Uint8Array;
  readonly mode: string;
}
export type FileSnapshot = Map<string, FileVersion>;

export function sameFile(a?: FileVersion, b?: FileVersion): boolean {
  return a === b || !!a && !!b && a.mode === b.mode &&
      a.bytes.length === b.bytes.length &&
      a.bytes.every((value, index) => value === b.bytes[index]);
}

/** Includes tracked and nonignored files; never follows directory symlinks. */
export async function snapshotFiles(
  root: URL,
  retainedPaths: Iterable<string> = [],
): Promise<FileSnapshot> {
  const result = await runCommand("git", {
    args: ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    cwd: root,
  });
  const paths = result.success
    ? [
      ...new Set(
        new TextDecoder().decode(result.stdout).split("\0").filter(Boolean),
      ),
    ]
    : await walk(root);
  const files: FileSnapshot = new Map();
  for (const path of new Set([...paths, ...retainedPaths])) {
    const url = repositoryUrl(repositoryRoot(root), path);
    try {
      const stat = await fs.lstat(url);
      if (stat.isSymbolicLink()) {
        files.set(path, {
          bytes: new TextEncoder().encode(await fs.readlink(url)),
          mode: "120000",
        });
      } else if (stat.isFile()) {
        files.set(path, {
          bytes: await fs.readFile(url),
          mode: stat.mode !== null && (stat.mode & 0o111) ? "100755" : "100644",
        });
      }
    } catch (error) {
      if (!(isNotFound(error))) throw error;
    }
  }
  return files;
}

async function walk(root: URL, prefix = ""): Promise<string[]> {
  const paths: string[] = [];
  for await (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const path = prefix + entry.name;
    if (entry.isDirectory()) {
      paths.push(
        ...await walk(
          new URL(`${encodeURIComponent(entry.name)}/`, root),
          `${path}/`,
        ),
      );
    } else paths.push(path);
  }
  return paths;
}

export function changedFiles(
  before: FileSnapshot,
  after: FileSnapshot,
): string[] {
  return [...new Set([...before.keys(), ...after.keys()])].filter((path) =>
    !sameFile(before.get(path), after.get(path))
  ).sort();
}
