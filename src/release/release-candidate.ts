/** Recreate and validate a prepared release against real Git trees and files. */
import { isNotFound } from "../runtime/errors.ts";
import * as fs from "node:fs/promises";
import { digestBytes } from "../repository/digest-bytes.ts";
import { LocalFileReader } from "../repository/local-file-reader.ts";
import { inspectDenoConfig } from "../features/deno-config.ts";
import {
  applyBundleChangelog,
  type ReleaseBundle,
  validateReleaseBundleFiles,
} from "./release-bundle.ts";
import { releaseCommitSubject } from "./names.ts";
import { type ReleaseProcess, runOrThrow } from "./release-process.ts";
import { makeReleaseTempDir } from "./release-temp.ts";
import { type ReleaseTag, selectPreviousRelease } from "./previous-release.ts";
const sha = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

export async function fetchSelected(
  root: URL,
  process: ReleaseProcess,
  bundle: ReleaseBundle,
): Promise<void> {
  await fetchMain(process);
  await runOrThrow(process, "git", ["fetch", "origin", "--tags"]);
  if (
    line(
      await runOrThrow(process, "git", ["rev-parse", "origin/main^{commit}"]),
    ) !== bundle.selectedSha
  ) throw new Error("origin/main changed after preparation.");
  await runOrThrow(process, "git", ["switch", "--detach", bundle.selectedSha]);
  if (
    (await runOrThrow(process, "git", ["status", "--porcelain=v1", "-z"]))
      .length
  ) throw new Error("Release apply requires a clean selected tree.");
  await revalidatePreviousRelease(root, process, bundle);
}

export async function checkoutRecoverySelected(
  root: URL,
  process: ReleaseProcess,
  bundle: ReleaseBundle,
): Promise<void> {
  const ancestor = await process.run("git", [
    "merge-base",
    "--is-ancestor",
    bundle.selectedSha,
    "origin/main",
  ]);
  if (ancestor.code !== 0 && ancestor.code !== 1) {
    throw new Error("Could not determine recovery release ancestry.");
  }
  if (ancestor.code === 1) {
    throw new Error("Recovery release parent is not on origin/main.");
  }
  await runOrThrow(process, "git", ["switch", "--detach", bundle.selectedSha]);
  if (
    (await runOrThrow(process, "git", ["status", "--porcelain=v1", "-z"]))
      .length
  ) throw new Error("Release recovery requires a clean selected tree.");
  await revalidatePreviousRelease(root, process, bundle);
}

export async function fetchMain(process: ReleaseProcess): Promise<void> {
  await runOrThrow(process, "git", [
    "fetch",
    "origin",
    "+refs/heads/main:refs/remotes/origin/main",
  ]);
  await runOrThrow(process, "git", ["fetch", "origin", "--tags"]);
}

async function revalidatePreviousRelease(
  root: URL,
  process: ReleaseProcess,
  bundle: ReleaseBundle,
): Promise<void> {
  const config = await inspectDenoConfig({
    files: new LocalFileReader(root, false),
  });
  if (config.kind !== "config" || typeof config.value.version !== "string") {
    throw new Error("One Deno config with a string version is required.");
  }
  const tags: ReleaseTag[] = [];
  const text = await runOrThrow(process, "git", [
    "for-each-ref",
    "--format=%(refname:strip=2)%00%(objecttype)%00%(objectname)%00%(*objectname)%00",
    "refs/tags",
  ]);
  const fields = text.split("\0");
  for (let index = 0; index + 3 < fields.length; index += 4) {
    const name = fields[index].replace(/^\n+/, "");
    const objectType = fields[index + 1];
    const target = objectType === "commit"
      ? fields[index + 2]
      : fields[index + 3];
    if (!name || !sha.test(target)) continue;
    const ancestor = await process.run("git", [
      "merge-base",
      "--is-ancestor",
      target,
      bundle.selectedSha,
    ]);
    if (ancestor.code !== 0 && ancestor.code !== 1) {
      throw new Error("Could not determine release-tag ancestry.");
    }
    tags.push({
      name,
      target,
      lightweight: objectType === "commit",
      targetIsAncestor: ancestor.code === 0,
    });
  }
  const previous = selectPreviousRelease(tags, config.value.version);
  const tag = previous.kind === "tag" ? previous.tag : undefined;
  if (
    previous.kind === "conflict" || previous.kind === "version-mismatch" ||
    (tag?.name ?? null) !== bundle.previousTag ||
    (tag?.target ?? null) !== bundle.previousTagTarget ||
    (previous.kind === "baseline" ? previous.version : tag?.name) !==
      bundle.previousVersion
  ) {
    throw new Error("Previous release selection changed after preparation.");
  }
}

export async function verifySelectedTree(
  root: URL,
  process: ReleaseProcess,
  bundle: ReleaseBundle,
): Promise<void> {
  const versionUrl = new URL(bundle.versionFile.path, root);
  const changelogUrl = new URL(bundle.changelog.path, root);
  const oldVersion = await fs.readFile(versionUrl, "utf8");
  const oldChangelog = await readOptional(changelogUrl);
  await validateReleaseBundleFiles(bundle, oldVersion, oldChangelog);
  await fs.writeFile(versionUrl, bundle.versionFile.text);
  await fs.writeFile(
    changelogUrl,
    applyBundleChangelog(oldChangelog ?? "", bundle),
  );
  await runOrThrow(process, "deno", [
    "fmt",
    "--check",
    bundle.versionFile.path,
    bundle.changelog.path,
  ]);
  await runOrThrow(process, "git", ["add", "--", ...bundle.changedPaths]);
  const changed = lines0(
    await runOrThrow(process, "git", [
      "diff",
      "--cached",
      "--name-only",
      "-z",
    ]),
  ).sort();
  if (
    JSON.stringify(changed) !== JSON.stringify([...bundle.changedPaths].sort())
  ) throw new Error("Applied release paths differ from bundle.");
  if (
    (await runOrThrow(process, "git", ["diff", "--name-only", "-z"]))
      .length ||
    (await runOrThrow(process, "git", [
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
    ])).length
  ) throw new Error("Release apply left unexpected worktree data.");
  if (await indexDigest(process) !== bundle.treeDigest) {
    throw new Error("Applied release tree differs from bundle.");
  }
}

export async function validateReleaseCommit(
  process: ReleaseProcess,
  bundle: ReleaseBundle,
  commit: string,
  parent: string,
): Promise<void> {
  if (!await isReleaseCommit(process, bundle, commit, parent)) {
    throw new Error("Release commit does not match bundle.");
  }
}

export async function isReleaseCommit(
  process: ReleaseProcess,
  bundle: ReleaseBundle,
  commit: string,
  parent?: string,
): Promise<boolean> {
  if (!sha.test(commit)) return false;
  const data = lines(
    await runOrThrow(process, "git", ["show", "-s", "--format=%P%n%s", commit]),
  );
  if (
    data.length !== 2 || (parent !== undefined && data[0] !== parent) ||
    data[0].includes(" ") ||
    data[1] !== releaseCommitSubject(bundle.nextVersion)
  ) return false;
  if (await commitTreeDigest(process, commit) !== bundle.treeDigest) {
    return false;
  }
  try {
    const oldVersion = await showFile(
      process,
      data[0],
      bundle.versionFile.path,
    );
    const oldChangelog = await showOptionalFile(
      process,
      data[0],
      bundle.changelog.path,
    );
    await validateReleaseBundleFiles(bundle, oldVersion, oldChangelog);
    if (
      await showFile(process, commit, bundle.versionFile.path) !==
        bundle.versionFile.text ||
      await showFile(process, commit, bundle.changelog.path) !==
        applyBundleChangelog(oldChangelog ?? "", bundle)
    ) return false;
  } catch {
    return false;
  }
  return true;
}

async function indexDigest(process: ReleaseProcess): Promise<string> {
  const result = await process.run("git", ["ls-files", "--stage", "-z"]);
  if (!result.success) throw new Error("Could not read release index.");
  return await digestBytes(result.stdout);
}

async function commitTreeDigest(
  process: ReleaseProcess,
  commit: string,
): Promise<string> {
  const directory = await makeReleaseTempDir("hj-release-apply-index-");
  try {
    const env = { GIT_INDEX_FILE: `${directory}/index` };
    await runOrThrow(process, "git", ["read-tree", commit], { env });
    const result = await process.run("git", ["ls-files", "--stage", "-z"], {
      env,
    });
    if (!result.success) throw new Error("Could not read release tree.");
    return await digestBytes(result.stdout);
  } finally {
    await fs.rm(directory, { recursive: true });
  }
}

async function readOptional(path: URL): Promise<string | undefined> {
  try {
    return await fs.readFile(path, "utf8");
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

async function showFile(
  process: ReleaseProcess,
  commit: string,
  path: string,
): Promise<string> {
  return await runOrThrow(process, "git", ["show", `${commit}:${path}`]);
}

async function showOptionalFile(
  process: ReleaseProcess,
  commit: string,
  path: string,
): Promise<string | undefined> {
  const result = await process.run("git", ["show", `${commit}:${path}`]);
  return result.success ? new TextDecoder().decode(result.stdout) : undefined;
}

export function line(value: string): string {
  const values = lines(value);
  if (values.length !== 1) throw new Error("Git returned ambiguous data.");
  return values[0];
}

export function lines(value: string): string[] {
  return value.split("\n").filter(Boolean);
}

function lines0(value: string): string[] {
  return value.split("\0").filter(Boolean);
}
