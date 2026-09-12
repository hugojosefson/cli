/** @module File snapshots for attributing feature changes without staging user files. */
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
  const result = await new Deno.Command("git", {
    args: ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    cwd: root,
  }).output();
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
      const stat = await Deno.lstat(url);
      if (stat.isSymlink) {
        files.set(path, {
          bytes: new TextEncoder().encode(await Deno.readLink(url)),
          mode: "120000",
        });
      } else if (stat.isFile) {
        files.set(path, {
          bytes: await Deno.readFile(url),
          mode: stat.mode !== null && (stat.mode & 0o111) ? "100755" : "100644",
        });
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
  return files;
}

async function walk(root: URL, prefix = ""): Promise<string[]> {
  const paths: string[] = [];
  for await (const entry of Deno.readDir(root)) {
    if (entry.name === ".git") continue;
    const path = prefix + entry.name;
    if (entry.isDirectory) {
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
