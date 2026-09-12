/** @module Guarded filesystem changes beneath a repository root. */
import * as fs from "node:fs/promises";

import type { PlannedChange } from "../api/planned-change.ts";
import { LocalFileReader } from "../repository/local-file-reader.ts";
import type { RepositoryRoot } from "../repository/repository-path.ts";
import { ChangePlanError } from "./change-plan-error.ts";
import { createDirectory } from "./local-directory-change.ts";
import { editJson } from "./local-json-change.ts";
import { pathExists } from "./local-path-exists.ts";
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
      | "github-ruleset-transition"
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

async function writeFile(
  root: RepositoryRoot,
  url: URL,
  content: string,
  expected: string | undefined,
  mode: number | undefined,
  path: string,
): Promise<void> {
  const observed = await new LocalFileReader(root.url, false).observe(path);
  const matches = expected === undefined
    ? observed.kind === "absent"
    : observed.kind === "file" && observed.digest === expected;
  if (!matches) throw new ChangePlanError("expected-state", path);
  await fs.writeFile(
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
  if (await pathExists(url)) throw new ChangePlanError("expected-state", path);
  await fs.symlink(target, url);
}

async function removeLink(
  url: URL,
  expected: string,
  path: string,
): Promise<void> {
  if (await linkTarget(url) !== expected) {
    throw new ChangePlanError("expected-state", path);
  }
  await fs.rm(url);
}

async function removeFile(
  root: RepositoryRoot,
  url: URL,
  path: string,
  expected: string,
): Promise<void> {
  if (await new LocalFileReader(root.url, false).digest(path) !== expected) {
    throw new ChangePlanError("expected-state", path);
  }
  await fs.rm(url);
}

async function removeDirectory(
  root: RepositoryRoot,
  url: URL,
  path: string,
  expected: string,
): Promise<void> {
  if (
    await new LocalFileReader(root.url, false).directoryStateDigest(path) !==
      expected
  ) throw new ChangePlanError("expected-state", path);
  await fs.rm(url, { recursive: true });
}

async function setMode(
  root: RepositoryRoot,
  url: URL,
  path: string,
  expected: number | undefined,
  mode: number,
): Promise<void> {
  const observed = await new LocalFileReader(root.url, false).observe(path);
  const matches = expected === undefined
    ? observed.kind === "absent"
    : observed.kind === "file" && observed.mode === expected;
  if (!matches) throw new ChangePlanError("expected-state", path);
  await fs.chmod(url, mode);
}
