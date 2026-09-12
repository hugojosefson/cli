/** @module Read-only-token preparation routes for tag publication. */
import * as fs from "node:fs/promises";

import { requiredEnvironment } from "./release-environment.ts";
import { digestBytes } from "../repository/digest-bytes.ts";
import { LocalFileReader } from "../repository/local-file-reader.ts";
import { LocalGitReader } from "../repository/local-git-reader.ts";
import { inspectDenoConfig } from "../features/deno-config.ts";
import { githubReleasePublisherFeatures } from "../features/github-release-publish-feature.ts";
import {
  applyChangelogInsertion,
  createChangelogInsertion,
  createReleaseSection,
} from "./changelog.ts";
import { validateConventionalCommits } from "./conventional-commit.ts";
import { nextVersion } from "./fork-version.ts";
import { validateGithubOutputSize } from "./github-output.ts";
import { type ReleaseTag, selectPreviousRelease } from "./previous-release.ts";
import {
  changelogPath,
  encodeReleaseBundle,
  type ReleaseBundle,
} from "./release-bundle.ts";
import type { ReleaseProcess } from "./release-process.ts";
import { runOrThrow } from "./release-process.ts";
import { selectReleaseType } from "./release-type.ts";
import {
  releaseTreeIndexDigest,
  restoreRecoveryWorktree,
} from "./recovery-worktree.ts";
import { parseSemver } from "./semver.ts";
import { validateSourceCommitRange } from "./source-commit-validation.ts";
import { updateDenoConfigVersion } from "./version-file.ts";
import type { ReleaseEnvironment } from "./release-environment.ts";
import { makeReleaseTempDir } from "./release-temp.ts";

export type PublishTagPrepareResult = {
  readonly output: string;
  readonly releaseNeeded: boolean;
};

const sha = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

export async function publishTagPrepare(
  root: URL,
  environment: ReleaseEnvironment,
  process: ReleaseProcess,
): Promise<PublishTagPrepareResult> {
  const route = environment.get("HJ_RELEASE_ROUTE");
  if (route === "source-validation") {
    const base = requiredEnvironment(environment, "HJ_SOURCE_BASE_SHA");
    const head = requiredEnvironment(environment, "HJ_SOURCE_HEAD_SHA");
    await validateSourceCommitRange(process, base, head);
    return { output: "Source commits are valid.\n", releaseNeeded: false };
  }
  if (route === "recovery") {
    return await prepareRecovery(root, environment, process);
  }
  if (route !== "usual") {
    throw new Error(
      "HJ_RELEASE_ROUTE must be source-validation, usual, or recovery.",
    );
  }
  return await prepareUsual(root, environment, process);
}

async function prepareUsual(
  root: URL,
  environment: ReleaseEnvironment,
  process: ReleaseProcess,
): Promise<PublishTagPrepareResult> {
  await requireClean(process);
  await runOrThrow(process, "git", [
    "fetch",
    "origin",
    "+refs/heads/main:refs/remotes/origin/main",
  ]);
  await runOrThrow(process, "git", ["fetch", "origin", "--tags"]);
  const selectedSha = singleLine(
    await runOrThrow(process, "git", ["rev-parse", "origin/main^{commit}"]),
  );
  if (!sha.test(selectedSha)) {
    throw new Error("origin/main has an invalid SHA.");
  }
  await runOrThrow(process, "git", ["switch", "--detach", selectedSha]);
  await requireClean(process);

  const files = new LocalFileReader(root, false);
  const config = await inspectDenoConfig({ files });
  if (
    config.kind !== "config" || typeof config.value.version !== "string"
  ) throw new Error("One Deno config with a string version is required.");
  const tags = await releaseTags(process, selectedSha);
  await requireNoUntaggedRelease(root, process, selectedSha, tags);
  await runOrThrow(process, "git", ["switch", "--detach", selectedSha]);
  const previous = selectPreviousRelease(tags, config.value.version);
  if (previous.kind === "conflict") {
    throw new Error("Applicable release tags have equal SemVer precedence.");
  }
  if (previous.kind === "version-mismatch") {
    throw new Error("The configured version does not equal the previous tag.");
  }
  const previousTag = previous.kind === "tag" ? previous.tag.name : null;
  const previousTagTarget = previous.kind === "tag"
    ? previous.tag.target
    : null;
  const previousVersion = previous.kind === "tag"
    ? previous.tag.name
    : previous.version;
  const range = previousTagTarget
    ? `${previousTagTarget}..${selectedSha}`
    : selectedSha;
  const commits = lines(
    await runOrThrow(process, "git", ["rev-list", "--reverse", range]),
  );
  if (commits.length === 0) {
    await writeOutputs(environment, { "release-needed": "false" });
    return { output: "No release is needed.\n", releaseNeeded: false };
  }
  const messages = await commitMessages(process, commits);
  const conventional = validateConventionalCommits(messages);
  const releaseType = selectReleaseType(conventional);
  if (!releaseType) throw new Error("The release range is empty.");
  const version = await nextVersion(previousVersion, releaseType);

  await runOrThrow(process, "deno", ["task", "all"]);
  await requireClean(process);
  const previousVersionText = config.text;
  const versionText = updateDenoConfigVersion(
    config.path,
    config.text,
    version,
  );
  const changelog = await observeOptionalFile(files, changelogPath);
  const releaseSection = createReleaseSection(
    version,
    conventional.map((commit) => commit.subject),
  );
  const insertion = createChangelogInsertion(
    changelog?.content ?? "",
    releaseSection,
  );
  await fs.writeFile(new URL(config.path, root), versionText);
  await fs.writeFile(
    new URL(changelogPath, root),
    applyChangelogInsertion(changelog?.content ?? "", insertion),
  );
  await runOrThrow(process, "deno", ["fmt", config.path, changelogPath]);
  const formattedVersion = await fs.readFile(
    new URL(config.path, root),
    "utf8",
  );
  const formattedChangelog = await fs.readFile(
    new URL(changelogPath, root),
    "utf8",
  );
  const formattedInsertion = retainedInsertion(
    changelog?.content ?? "",
    formattedChangelog,
    insertion.offset,
  );
  await runOrThrow(process, "deno", ["task", "all"]);
  if (
    await fs.readFile(new URL(config.path, root), "utf8") !==
      formattedVersion ||
    await fs.readFile(new URL(changelogPath, root), "utf8") !==
      formattedChangelog
  ) throw new Error("Candidate validation changed release data.");
  await runReleaseContributions(root, files, process);
  const changedPaths = await worktreeChangedPaths(process);
  const expectedPaths = [config.path, changelogPath];
  if (
    changedPaths.length !== expectedPaths.length ||
    !expectedPaths.every((path) => changedPaths.includes(path))
  ) throw new Error("Release preparation changed an unexpected path.");

  const bundle: ReleaseBundle = {
    schema: 1,
    previousTag,
    previousTagTarget,
    selectedSha,
    previousVersion,
    nextVersion: version,
    releaseType,
    versionFile: {
      path: config.path,
      previousDigest: await digestText(previousVersionText),
      text: formattedVersion,
      digest: await digestText(formattedVersion),
    },
    changelog: {
      path: changelogPath,
      previousDigest: changelog ? await digestText(changelog.content) : null,
      offset: insertion.offset,
      insertion: formattedInsertion,
      digest: await digestText(formattedChangelog),
    },
    changedPaths: expectedPaths,
    treeDigest: await candidateTreeDigest(process, selectedSha, expectedPaths),
  };
  const encoded = await encodeReleaseBundle(bundle);
  const outputs = {
    "release-needed": "true",
    "release-bundle": encoded.bundle,
    "bundle-digest": encoded.digest,
  };
  validateGithubOutputSize(Object.values(outputs));
  await writeOutputs(environment, outputs);
  await writeSummary(
    environment,
    `## Release ${version}\n\nSelected \`${selectedSha}\` for a ${releaseType} release.\n`,
  );
  return {
    output: `Prepared release ${version}.\n`,
    releaseNeeded: true,
  };
}

/** Runs only contributions whose generated publisher workflow is exact. */
async function runReleaseContributions(
  root: URL,
  files: LocalFileReader,
  process: ReleaseProcess,
): Promise<void> {
  const context = {
    repositoryRoot: root,
    files,
    git: new LocalGitReader(root),
  };
  for (const feature of githubReleasePublisherFeatures) {
    const contributions = feature.releaseContributions ?? [];
    if (contributions.length === 0) continue;
    const detection = await feature.detect(context);
    if (detection.state === "disabled") continue;
    if (detection.state !== "enabled") {
      throw new Error(
        `${feature.metadata.id} must be exact before release preparation.`,
      );
    }
    for (const contribution of contributions) {
      await runOrThrow(
        process,
        contribution.command,
        [...contribution.args],
      );
    }
  }
}

/** Rebuilds a committed release; it intentionally never creates a ref or tag. */
async function prepareRecovery(
  root: URL,
  environment: ReleaseEnvironment,
  process: ReleaseProcess,
): Promise<PublishTagPrepareResult> {
  const version = requiredEnvironment(environment, "HJ_RELEASE_TAG");
  if (!parseSemver(version)) {
    throw new Error("HJ_RELEASE_TAG must be an exact nonempty SemVer value.");
  }
  await requireClean(process);
  await runOrThrow(process, "git", [
    "fetch",
    "origin",
    "+refs/heads/main:refs/remotes/origin/main",
  ]);
  await runOrThrow(process, "git", ["fetch", "origin", "--tags"]);
  const main = singleLine(
    await runOrThrow(process, "git", ["rev-parse", "origin/main^{commit}"]),
  );
  const tags = await releaseTags(process, main);
  const sameName = tags.filter((tag) => tag.name === version);
  const commits = lines(
    await runOrThrow(process, "git", ["rev-list", "--reverse", main]),
  );
  const matches: { commit: string; bundle: ReleaseBundle }[] = [];
  for (const commit of commits) {
    const subject = singleLine(
      await runOrThrow(process, "git", ["show", "-s", "--format=%s", commit]),
    );
    if (subject !== `chore(release): ${version}`) continue;
    const parentLine = singleLine(
      await runOrThrow(process, "git", [
        "rev-list",
        "--parents",
        "-n",
        "1",
        commit,
      ]),
    );
    const parents = parentLine.split(" ");
    if (parents.length !== 2 || !sha.test(parents[1])) {
      throw new Error("Recovery release commit must have exactly one parent.");
    }
    let bundle: ReleaseBundle;
    try {
      bundle = await rebuildRelease(root, process, parents[1], commit);
    } finally {
      await restoreRecoveryWorktree(process, main, changelogPath);
    }
    if (bundle.nextVersion === version) matches.push({ commit, bundle });
  }
  if (matches.length !== 1) {
    throw new Error(
      matches.length
        ? "Recovery release commit is ambiguous."
        : "No correct recovery release commit was found.",
    );
  }
  const match = matches[0];
  if (sameName.some((tag) => !tag.lightweight || tag.target !== match.commit)) {
    throw new Error("The recovery tag conflicts with the release commit.");
  }
  const encoded = await encodeReleaseBundle(match.bundle);
  const outputs = {
    "release-needed": "true",
    "release-bundle": encoded.bundle,
    "bundle-digest": encoded.digest,
  };
  validateGithubOutputSize(Object.values(outputs));
  await writeOutputs(environment, outputs);
  await writeSummary(
    environment,
    `## Release ${version}\n\nRecovered \`${match.commit}\`.\n`,
  );
  return {
    output: `Prepared recovery release ${version}.\n`,
    releaseNeeded: true,
  };
}

async function requireNoUntaggedRelease(
  root: URL,
  process: ReleaseProcess,
  selectedSha: string,
  tags: readonly ReleaseTag[],
): Promise<void> {
  const commits = lines(
    await runOrThrow(process, "git", ["rev-list", "--reverse", selectedSha]),
  );
  const found: { commit: string; version: string }[] = [];
  for (const commit of commits) {
    const subject = singleLine(
      await runOrThrow(process, "git", ["show", "-s", "--format=%s", commit]),
    );
    const match = /^chore\(release\): (.+)$/.exec(subject);
    if (!match || !parseSemver(match[1])) continue;
    const parentLine = singleLine(
      await runOrThrow(process, "git", [
        "rev-list",
        "--parents",
        "-n",
        "1",
        commit,
      ]),
    );
    const parents = parentLine.split(" ");
    if (parents.length !== 2) {
      throw new Error("Release commit data is malformed.");
    }
    let bundle: ReleaseBundle;
    try {
      bundle = await rebuildRelease(root, process, parents[1], commit);
    } finally {
      await restoreRecoveryWorktree(process, selectedSha, changelogPath);
    }
    if (bundle.nextVersion !== match[1]) continue;
    const named = tags.filter((tag) => tag.name === match[1]);
    if (named.some((tag) => !tag.lightweight || tag.target !== commit)) {
      throw new Error(
        "Reserved release tag data conflicts with a release commit.",
      );
    }
    if (!named.some((tag) => tag.lightweight && tag.target === commit)) {
      found.push({ commit, version: match[1] });
    }
  }
  if (found.length > 1) {
    throw new Error("More than one untagged release commit was found.");
  }
  if (found.length === 1) {
    throw new Error(
      `Release ${found[0].version} is untagged; start the tag workflow with ${
        found[0].version
      }.`,
    );
  }
}

async function rebuildRelease(
  root: URL,
  process: ReleaseProcess,
  parent: string,
  release: string,
): Promise<ReleaseBundle> {
  await runOrThrow(process, "git", ["switch", "--detach", parent]);
  const files = new LocalFileReader(root, false);
  const config = await inspectDenoConfig({ files });
  if (config.kind !== "config" || typeof config.value.version !== "string") {
    throw new Error("One Deno config with a string version is required.");
  }
  const previous = selectPreviousRelease(
    await releaseTags(process, parent),
    config.value.version,
  );
  if (previous.kind === "conflict" || previous.kind === "version-mismatch") {
    throw new Error("Previous release data is invalid.");
  }
  const previousTag = previous.kind === "tag" ? previous.tag.name : null;
  const previousTagTarget = previous.kind === "tag"
    ? previous.tag.target
    : null;
  const previousVersion = previous.kind === "tag"
    ? previous.tag.name
    : previous.version;
  const range = previousTagTarget ? `${previousTagTarget}..${parent}` : parent;
  const commitIds = lines(
    await runOrThrow(process, "git", ["rev-list", "--reverse", range]),
  );
  const conventional = validateConventionalCommits(
    await commitMessages(process, commitIds),
  );
  const releaseType = selectReleaseType(conventional);
  if (!releaseType) throw new Error("Recovery release range is empty.");
  const version = await nextVersion(previousVersion, releaseType);
  const oldChangelog = await observeOptionalFile(files, changelogPath);
  const versionText = updateDenoConfigVersion(
    config.path,
    config.text,
    version,
  );
  const insertion = createChangelogInsertion(
    oldChangelog?.content ?? "",
    createReleaseSection(version, conventional.map((item) => item.subject)),
  );
  await fs.writeFile(new URL(config.path, root), versionText);
  await fs.writeFile(
    new URL(changelogPath, root),
    applyChangelogInsertion(oldChangelog?.content ?? "", insertion),
  );
  await runOrThrow(process, "deno", ["fmt", config.path, changelogPath]);
  const formattedVersion = await fs.readFile(
    new URL(config.path, root),
    "utf8",
  );
  const formattedChangelog = await fs.readFile(
    new URL(changelogPath, root),
    "utf8",
  );
  const formattedInsertion = retainedInsertion(
    oldChangelog?.content ?? "",
    formattedChangelog,
    insertion.offset,
  );
  const paths = await worktreeChangedPaths(process);
  const expectedPaths = [config.path, changelogPath];
  if (
    paths.length !== 2 || !expectedPaths.every((path) => paths.includes(path))
  ) throw new Error("Recovery candidate changed an unexpected path.");
  const candidateDigest = await candidateTreeDigest(
    process,
    parent,
    expectedPaths,
  );
  const releaseDigest = await releaseTreeIndexDigest(process, release);
  if (candidateDigest !== releaseDigest) {
    throw new Error(
      "Recovery release tree differs from its expected candidate.",
    );
  }
  const releasePaths = (await runOrThrow(process, "git", [
    "diff-tree",
    "--no-commit-id",
    "--name-only",
    "-r",
    "-z",
    release,
  ])).split("\0").filter(Boolean).sort();
  if (
    releasePaths.length !== expectedPaths.length ||
    !expectedPaths.every((path) => releasePaths.includes(path))
  ) {
    throw new Error("Recovery release changed unexpected paths.");
  }
  return {
    schema: 1,
    previousTag,
    previousTagTarget,
    selectedSha: parent,
    previousVersion,
    nextVersion: version,
    releaseType,
    versionFile: {
      path: config.path,
      previousDigest: await digestText(config.text),
      text: formattedVersion,
      digest: await digestText(formattedVersion),
    },
    changelog: {
      path: changelogPath,
      previousDigest: oldChangelog
        ? await digestText(oldChangelog.content)
        : null,
      offset: insertion.offset,
      insertion: formattedInsertion,
      digest: await digestText(formattedChangelog),
    },
    changedPaths: expectedPaths,
    treeDigest: candidateDigest,
  };
}

async function releaseTags(
  process: ReleaseProcess,
  selectedSha: string,
): Promise<readonly ReleaseTag[]> {
  const text = await runOrThrow(process, "git", [
    "for-each-ref",
    "--format=%(refname:strip=2)%00%(objecttype)%00%(objectname)%00%(*objectname)%00",
    "refs/tags",
  ]);
  const fields = text.split("\0");
  const tags: ReleaseTag[] = [];
  for (let index = 0; index + 3 < fields.length; index += 4) {
    const name = fields[index].replace(/^\n+/, "");
    const objectType = fields[index + 1];
    const objectName = fields[index + 2];
    const peeled = fields[index + 3];
    if (!name) continue;
    const target = objectType === "commit" ? objectName : peeled;
    if (!sha.test(target)) continue;
    const ancestor = await process.run("git", [
      "merge-base",
      "--is-ancestor",
      target,
      selectedSha,
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
  return tags;
}

async function commitMessages(
  process: ReleaseProcess,
  commits: readonly string[],
): Promise<readonly string[]> {
  const messages: string[] = [];
  for (const commit of commits) {
    if (!sha.test(commit)) {
      throw new Error("Git returned an invalid commit SHA.");
    }
    messages.push((await runOrThrow(process, "git", [
      "show",
      "--no-patch",
      "--format=%B",
      commit,
    ])).replace(/\n+$/, ""));
  }
  return messages;
}

async function requireClean(process: ReleaseProcess): Promise<void> {
  const status = await runOrThrow(process, "git", [
    "status",
    "--porcelain=v1",
    "-z",
  ]);
  if (status.length) {
    throw new Error("Release preparation requires a clean tree.");
  }
}

async function worktreeChangedPaths(
  process: ReleaseProcess,
): Promise<readonly string[]> {
  const tracked = (await runOrThrow(process, "git", [
    "diff",
    "--name-only",
    "-z",
  ])).split("\0").filter(Boolean);
  const untracked = (await runOrThrow(process, "git", [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
  ])).split("\0").filter(Boolean);
  return [...new Set([...tracked, ...untracked])].sort();
}

async function candidateTreeDigest(
  process: ReleaseProcess,
  selectedSha: string,
  paths: readonly string[],
): Promise<string> {
  const directory = await makeReleaseTempDir("hj-release-index-");
  const index = `${directory}/index`;
  try {
    const env = { GIT_INDEX_FILE: index };
    await runOrThrow(process, "git", ["read-tree", selectedSha], { env });
    await runOrThrow(process, "git", ["add", "--", ...paths], { env });
    const result = await process.run("git", ["ls-files", "--stage", "-z"], {
      env,
    });
    if (!result.success) {
      throw new Error("Could not calculate the release tree.");
    }
    return await digestBytes(result.stdout);
  } finally {
    await fs.rm(directory, { recursive: true });
  }
}

async function observeOptionalFile(
  files: LocalFileReader,
  path: string,
): Promise<{ readonly content: string } | undefined> {
  const observation = await files.observe(path);
  if (observation.kind === "absent") return undefined;
  if (observation.kind !== "file") {
    throw new Error(`${path} must be absent or a regular file.`);
  }
  return { content: observation.content };
}

function retainedInsertion(
  oldText: string,
  formattedText: string,
  offset: number,
): string {
  const prefix = oldText.slice(0, offset);
  const suffix = oldText.slice(offset);
  if (!formattedText.startsWith(prefix) || !formattedText.endsWith(suffix)) {
    throw new Error("Formatting changed previous changelog text.");
  }
  return formattedText.slice(
    prefix.length,
    formattedText.length - suffix.length,
  );
}

async function writeOutputs(
  environment: ReleaseEnvironment,
  outputs: Readonly<Record<string, string>>,
): Promise<void> {
  const path = environment.get("GITHUB_OUTPUT");
  if (!path) return;
  const text = Object.entries(outputs).map(([name, value]) =>
    `${name}=${value}\n`
  )
    .join("");
  await fs.writeFile(path, text, { flag: "a" });
}

async function writeSummary(
  environment: ReleaseEnvironment,
  text: string,
): Promise<void> {
  const path = environment.get("GITHUB_STEP_SUMMARY");
  if (path) await fs.writeFile(path, text, { flag: "a" });
}

function singleLine(value: string): string {
  const values = lines(value);
  if (values.length !== 1) throw new Error("Git returned ambiguous data.");
  return values[0];
}

function lines(value: string): readonly string[] {
  return value.split("\n").filter(Boolean);
}

async function digestText(text: string): Promise<string> {
  return await digestBytes(new TextEncoder().encode(text));
}
