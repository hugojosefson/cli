/** @module Safe read paths for README inputs and includes. */
import type { Stats } from "node:fs";
import * as fs from "node:fs/promises";

import { isAbsolute, relative, resolve } from "@std/path";

export async function readmeRoot(root: URL): Promise<string> {
  return await fs.realpath(root);
}

export async function resolveReadmePath(
  root: string,
  base: string,
  path: string,
): Promise<string> {
  if (!path || path.includes("\0") || isAbsolute(path)) {
    throw new Error(`README path must be relative: ${path}`);
  }
  const resolved = resolve(base, path);
  const fromRoot = relative(root, resolved);
  if (
    fromRoot === "" || fromRoot === ".." || fromRoot.startsWith("../") ||
    isAbsolute(fromRoot)
  ) {
    throw new Error(`README path escapes repository root: ${path}`);
  }
  await rejectSymlinks(root, resolved, path);
  return resolved;
}

export async function readReadmeFile(
  root: string,
  base: string,
  input: string,
): Promise<{ readonly path: string; readonly text: string }> {
  const path = await resolveReadmePath(root, base, input);
  const before = await fs.lstat(path);
  assertRegular(before, input);
  const file = await fs.open(path, "r");
  try {
    const opened = await file.stat();
    assertRegular(opened, input);
    if (before.dev !== opened.dev || before.ino !== opened.ino) {
      throw new Error(`README file changed while opening: ${input}`);
    }
    return { path, text: new TextDecoder().decode(await file.readFile()) };
  } finally {
    await file.close();
  }
}

async function rejectSymlinks(
  root: string,
  target: string,
  input: string,
): Promise<void> {
  const parts = relative(root, target).split("/");
  let current = root;
  for (const part of parts) {
    current = resolve(current, part);
    if ((await fs.lstat(current)).isSymbolicLink()) {
      throw new Error(`README path traverses a symlink: ${input}`);
    }
  }
}

function assertRegular(info: Stats, input: string): void {
  if (!info.isFile()) {
    throw new Error(`README path is not a regular file: ${input}`);
  }
  if (info.dev === undefined || info.ino === undefined) {
    throw new Error(`Cannot verify README file identity: ${input}`);
  }
}
