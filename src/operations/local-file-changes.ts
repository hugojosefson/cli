/** @module Guarded filesystem changes beneath a repository root. */

import type { PlannedChange } from "../api/planned-change.ts";
import { LocalFileReader } from "../repository/local-file-reader.ts";
import type { RepositoryRoot } from "../repository/repository-path.ts";
import { ChangePlanError } from "./change-plan-error.ts";
import { editJson } from "./local-json-change.ts";
import { containedUrl, linkTarget } from "./local-plan-state.ts";

type FileChange = Exclude<
  PlannedChange,
  {
    readonly kind:
      | `git-${string}`
      | "create-git-branch"
      | "set-git-remote"
      | "upsert-github-resource"
      | "delete-github-resource"
      | "app-setup";
  }
>;

export async function applyFileChange(
  root: RepositoryRoot,
  change: FileChange,
): Promise<void> {
  const url = await containedUrl(root, change.path);
  if (change.kind === "create-directory") {
    return await createDirectory(url, change.path);
  }
  if (change.kind === "write-file") {
    return await writeFile(
      root,
      url,
      change.content,
      change.expectedDigest,
      change.mode,
      change.path,
    );
  }
  if (change.kind === "create-symlink") {
    return await createLink(url, change.target, change.path);
  }
  if (change.kind === "remove-symlink") {
    return await removeLink(url, change.expectedTarget, change.path);
  }
  if (change.kind === "remove-file") {
    return await removeFile(root, url, change.path, change.expectedDigest);
  }
  if (change.kind === "remove-directory") {
    return await removeDirectory(
      root,
      url,
      change.path,
      change.expectedStateDigest,
    );
  }
  if (change.kind === "set-file-mode") {
    return await setMode(
      root,
      url,
      change.path,
      change.expectedMode,
      change.mode,
    );
  }
  return await editJson(
    root,
    url,
    change.path,
    change.jsonPath,
    change.kind === "set-json" ? change.value : undefined,
    change.expected,
    change.kind === "remove-json",
  );
}

async function createDirectory(url: URL, path: string): Promise<void> {
  if (await exists(url)) throw new ChangePlanError("expected-state", path);
  await Deno.mkdir(url);
}

async function writeFile(
  root: RepositoryRoot,
  url: URL,
  content: string,
  expected: string | undefined,
  mode: number | undefined,
  path: string,
): Promise<void> {
  const observed = await new LocalFileReader(root.url).observe(path);
  const matches = expected === undefined
    ? observed.kind === "absent"
    : observed.kind === "file" && observed.digest === expected;
  if (!matches) throw new ChangePlanError("expected-state", path);
  await Deno.writeTextFile(
    url,
    content,
    mode === undefined || observed.kind === "file" ? undefined : { mode },
  );
}

async function createLink(
  url: URL,
  target: string,
  path: string,
): Promise<void> {
  if (await exists(url)) throw new ChangePlanError("expected-state", path);
  await Deno.symlink(target, url);
}

async function removeLink(
  url: URL,
  expected: string,
  path: string,
): Promise<void> {
  if (await linkTarget(url) !== expected) {
    throw new ChangePlanError("expected-state", path);
  }
  await Deno.remove(url);
}

async function removeFile(
  root: RepositoryRoot,
  url: URL,
  path: string,
  expected: string,
): Promise<void> {
  if (await new LocalFileReader(root.url).digest(path) !== expected) {
    throw new ChangePlanError("expected-state", path);
  }
  await Deno.remove(url);
}

async function removeDirectory(
  root: RepositoryRoot,
  url: URL,
  path: string,
  expected: string,
): Promise<void> {
  if (
    await new LocalFileReader(root.url).directoryStateDigest(path) !== expected
  ) throw new ChangePlanError("expected-state", path);
  await Deno.remove(url, { recursive: true });
}

async function setMode(
  root: RepositoryRoot,
  url: URL,
  path: string,
  expected: number | undefined,
  mode: number,
): Promise<void> {
  const observed = await new LocalFileReader(root.url).observe(path);
  const matches = expected === undefined
    ? observed.kind === "absent"
    : observed.kind === "file" && observed.mode === expected;
  if (!matches) throw new ChangePlanError("expected-state", path);
  await Deno.chmod(url, mode);
}

async function exists(url: URL): Promise<boolean> {
  try {
    await Deno.lstat(url);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}
