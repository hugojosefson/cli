/** @module Deterministic complete directory-state digests. */
import * as fs from "node:fs/promises";

import type { DirectoryStateDigest, FileMode } from "../api/json.ts";
import { digestBytes } from "./digest-bytes.ts";
import { fileMode } from "./file-mode.ts";

type DirectoryEntry =
  | { readonly path: string; readonly kind: "directory" }
  | { readonly path: string; readonly kind: "symlink"; readonly target: string }
  | {
    readonly path: string;
    readonly kind: "file";
    readonly mode: FileMode;
    readonly content: string;
  }
  | { readonly path: string; readonly kind: "other" };

/** Digests sorted relative paths, entry kinds, file modes/content, and links. */
export async function digestDirectoryState(
  directory: URL,
): Promise<DirectoryStateDigest> {
  const entries: DirectoryEntry[] = [];
  await collectDirectory(directory, "", entries);
  return await digestBytes(new TextEncoder().encode(JSON.stringify(entries)));
}

async function collectDirectory(
  directory: URL,
  relative: string,
  entries: DirectoryEntry[],
): Promise<void> {
  const base = new URL(
    directory.href.endsWith("/") ? directory.href : `${directory.href}/`,
  );
  const children: { name: string; url: URL }[] = [];
  for await (const entry of await fs.readdir(base, { withFileTypes: true })) {
    children.push({
      name: entry.name,
      url: new URL(encodeURIComponent(entry.name), base),
    });
  }
  children.sort((left, right) => compareText(left.name, right.name));
  for (const child of children) {
    const path = relative ? `${relative}/${child.name}` : child.name;
    const info = await fs.lstat(child.url);
    if (info.isDirectory()) {
      entries.push({ path, kind: "directory" });
      await collectDirectory(
        new URL(`${encodeURIComponent(child.name)}/`, base),
        path,
        entries,
      );
    } else if (info.isSymbolicLink()) {
      entries.push({
        path,
        kind: "symlink",
        target: await fs.readlink(child.url),
      });
    } else if (info.isFile()) {
      entries.push({
        path,
        kind: "file",
        mode: fileMode(info),
        content: await digestBytes(await fs.readFile(child.url)),
      });
    } else {
      entries.push({ path, kind: "other" });
    }
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
