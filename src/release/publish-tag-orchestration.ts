/** @module Validated local orchestration for publish-tag-apply. */

import {
  checkoutRecoverySelected,
  fetchMain,
  fetchSelected,
  isReleaseCommit,
  line,
  lines,
  validateReleaseCommit,
  verifySelectedTree,
} from "./release-candidate.ts";
import { requiredEnvironment } from "./release-environment.ts";
import { applyPublishTag } from "./publish-tag-apply.ts";
import {
  type ApplyClock,
  type ApplyGithub,
  ReleaseApplyConflictError,
  ReleasePullRequestNotFoundError,
} from "./apply-types.ts";
import { decodeReleaseBundle, type ReleaseBundle } from "./release-bundle.ts";
import { releaseBranch, releaseCommitSubject } from "./names.ts";
import { type ReleaseOwnership, releasePullRequestBody } from "./release-pr.ts";
import {
  recoverPublishedTag,
  type RecoveryGithub,
} from "./publish-tag-recovery.ts";
import type { ReleaseEnvironment } from "./release-environment.ts";
import type { ReleaseProcess } from "./release-process.ts";
import { runOrThrow } from "./release-process.ts";
import { parseSemver } from "./semver.ts";
import {
  releaseCheckContexts,
  releaseCheckExternalId,
} from "./synthetic-check.ts";

export type PublishTagApplyGithub = ApplyGithub & RecoveryGithub & {
  readReleaseBranch(): Promise<string | undefined>;
  pushReleaseBranch(branch: string, sha: string): Promise<void>;
  createReleasePullRequest(
    input: { title: string; body: string; head: string },
  ): Promise<void>;
};

/** Runs either apply route. All network and process effects are injected. */
export async function publishTagApply(
  root: URL,
  environment: ReleaseEnvironment,
  process: ReleaseProcess,
  github: PublishTagApplyGithub,
  clock: ApplyClock,
): Promise<void> {
  const bundle = await decodeReleaseBundle(
    requiredEnvironment(environment, "HJ_RELEASE_BUNDLE"),
    requiredEnvironment(environment, "HJ_RELEASE_BUNDLE_DIGEST"),
  );
  const route = requiredEnvironment(environment, "HJ_RELEASE_ROUTE");
  if (route === "usual") {
    await applyUsual(root, environment, process, github, clock, bundle);
    return;
  }
  if (route === "recovery") {
    await applyRecovery(root, environment, process, github, bundle);
    return;
  }
  throw new TypeError("HJ_RELEASE_ROUTE must be usual or recovery.");
}

async function applyUsual(
  root: URL,
  environment: ReleaseEnvironment,
  process: ReleaseProcess,
  github: PublishTagApplyGithub,
  clock: ApplyClock,
  bundle: ReleaseBundle,
): Promise<void> {
  const routeInput = usualRouteInput(environment, bundle);
  await fetchSelected(root, process, bundle);
  await verifySelectedTree(root, process, bundle);
  const releaseSha = await reserveReleaseCommit(process, github, bundle);
  const ownership: ReleaseOwnership = {
    schema: 1,
    selectedSha: bundle.selectedSha,
    version: bundle.nextVersion,
    branchHead: releaseSha,
    treeDigest: bundle.treeDigest,
  };
  await reservePullRequest(github, bundle, ownership);
  const outcome = await applyPublishTag(github, clock, {
    ...routeInput,
    releaseSha,
    selectedSha: bundle.selectedSha,
    ownership,
  });
  if (outcome === "source-first-collision") return;
  await fetchMain(process);
  const mergedSha = await findReleaseCommitOnMain(process, bundle);
  await recoverPublishedTag(github, {
    version: bundle.nextVersion,
    releaseSha: mergedSha,
    ownership,
  });
  await summary(environment, bundle.nextVersion, mergedSha);
}

async function applyRecovery(
  root: URL,
  environment: ReleaseEnvironment,
  process: ReleaseProcess,
  github: PublishTagApplyGithub,
  bundle: ReleaseBundle,
): Promise<void> {
  if (!parseSemver(bundle.nextVersion)) {
    throw new TypeError("Recovery version is not SemVer.");
  }
  await fetchMain(process);
  await checkoutRecoverySelected(root, process, bundle);
  const commits = lines(
    await runOrThrow(process, "git", ["rev-list", "origin/main"]),
  );
  const matches: string[] = [];
  for (const commit of commits) {
    if (await isReleaseCommit(process, bundle, commit, bundle.selectedSha)) {
      matches.push(commit);
    }
  }
  if (matches.length !== 1) {
    throw new Error(
      "Recovery requires exactly one correct release commit on main.",
    );
  }
  const releaseSha = matches[0];
  const branch = await github.readReleaseBranch();
  const ownership = branch === undefined
    ? {
      schema: 1 as const,
      selectedSha: bundle.selectedSha,
      version: bundle.nextVersion,
      branchHead: releaseSha,
      treeDigest: bundle.treeDigest,
    }
    : await recoveryOwnership(github, bundle, branch);
  await recoverPublishedTag(github, {
    version: bundle.nextVersion,
    releaseSha,
    ownership,
  });
  await summary(environment, bundle.nextVersion, releaseSha);
}

type UsualRouteInput = {
  readonly runId: string;
  readonly runAttempt: string;
  readonly bundleDigest: string;
  readonly detailsUrl: string;
};

function usualRouteInput(
  environment: ReleaseEnvironment,
  bundle: ReleaseBundle,
): UsualRouteInput {
  const runId = requiredEnvironment(environment, "GITHUB_RUN_ID");
  const runAttempt = requiredEnvironment(environment, "GITHUB_RUN_ATTEMPT");
  const bundleDigest = requiredEnvironment(
    environment,
    "HJ_RELEASE_BUNDLE_DIGEST",
  );
  const serverText = requiredEnvironment(environment, "GITHUB_SERVER_URL");
  const repository = requiredEnvironment(environment, "GITHUB_REPOSITORY");
  let server: URL;
  try {
    server = new URL(serverText);
  } catch {
    throw new TypeError("GITHUB_SERVER_URL is invalid.");
  }
  if (
    !/^[1-9][0-9]{0,19}$/.test(runId) ||
    !/^[1-9][0-9]{0,9}$/.test(runAttempt) ||
    !/^[0-9a-f]{64}$/.test(bundleDigest) ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
    server.protocol !== "https:" || server.username || server.password ||
    server.pathname !== "/" || server.search || server.hash
  ) {
    throw new TypeError("Release apply environment is invalid.");
  }
  const detailsUrl = `${server.origin}/${repository}/actions/runs/${runId}`;
  for (const context of releaseCheckContexts) {
    releaseCheckExternalId({
      runId,
      runAttempt,
      context,
      bundleDigest,
      releaseSha: bundle.selectedSha,
    });
  }
  return { runId, runAttempt, bundleDigest, detailsUrl };
}

async function recoveryOwnership(
  github: PublishTagApplyGithub,
  bundle: ReleaseBundle,
  branch: string,
): Promise<ReleaseOwnership> {
  const pullRequests = await github.mergedPullRequestsForReleaseBranch();
  const ownership = pullRequests[0]?.ownership;
  if (
    pullRequests.length !== 1 || ownership === undefined ||
    ownership.selectedSha !== bundle.selectedSha ||
    ownership.version !== bundle.nextVersion ||
    ownership.treeDigest !== bundle.treeDigest ||
    ownership.branchHead !== branch
  ) {
    throw new Error("Recovery branch is not exactly owned by this release.");
  }
  return ownership;
}

async function findReleaseCommitOnMain(
  process: ReleaseProcess,
  bundle: ReleaseBundle,
): Promise<string> {
  const matches: string[] = [];
  for (
    const commit of lines(
      await runOrThrow(process, "git", ["rev-list", "origin/main"]),
    )
  ) {
    if (await isReleaseCommit(process, bundle, commit, bundle.selectedSha)) {
      matches.push(commit);
    }
  }
  if (matches.length !== 1) {
    throw new Error("Expected exactly one rebased release commit on main.");
  }
  return matches[0];
}

async function reserveReleaseCommit(
  process: ReleaseProcess,
  github: PublishTagApplyGithub,
  bundle: ReleaseBundle,
): Promise<string> {
  const branch = releaseBranch(bundle.nextVersion);
  const remote = await github.readReleaseBranch();
  if (remote !== undefined) {
    await runOrThrow(process, "git", [
      "fetch",
      "--no-tags",
      "origin",
      `refs/heads/${branch}`,
    ]);
    const fetched = line(
      await runOrThrow(process, "git", ["rev-parse", "FETCH_HEAD^{commit}"]),
    );
    if (fetched !== remote) {
      throw new ReleaseApplyConflictError("Release branch changed while read.");
    }
    await validateReleaseCommit(process, bundle, remote, bundle.selectedSha);
    return remote;
  }
  await runOrThrow(process, "git", ["switch", "-c", branch]);
  await runOrThrow(process, "git", [
    "-c",
    "commit.gpgSign=false",
    "commit",
    "-m",
    releaseCommitSubject(bundle.nextVersion),
  ], {
    env: {
      GIT_AUTHOR_NAME: "github-actions[bot]",
      GIT_AUTHOR_EMAIL: "41898282+github-actions[bot]@users.noreply.github.com",
      GIT_COMMITTER_NAME: "github-actions[bot]",
      GIT_COMMITTER_EMAIL:
        "41898282+github-actions[bot]@users.noreply.github.com",
    },
  });
  const commit = line(await runOrThrow(process, "git", ["rev-parse", "HEAD"]));
  await validateReleaseCommit(process, bundle, commit, bundle.selectedSha);
  try {
    await github.pushReleaseBranch(branch, commit);
  } catch { /* fresh remote read resolves uncertain pushes */ }
  const observed = await github.readReleaseBranch();
  if (observed !== commit) {
    throw new Error("Release branch push was not confirmed.");
  }
  return commit;
}

async function reservePullRequest(
  github: PublishTagApplyGithub,
  bundle: ReleaseBundle,
  ownership: ReleaseOwnership,
): Promise<void> {
  let existing;
  try {
    existing = await github.readPullRequest();
  } catch (error) {
    if (!(error instanceof ReleasePullRequestNotFoundError)) throw error;
  }
  if (existing === undefined) {
    try {
      await github.createReleasePullRequest({
        title: releaseCommitSubject(bundle.nextVersion),
        body: releasePullRequestBody(ownership),
        head: releaseBranch(bundle.nextVersion),
      });
    } catch { /* a fresh read resolves an uncertain create request */ }
  }
  const pr = existing ?? await github.readPullRequest();
  if (
    pr.state !== "OPEN" ||
    pr.title !== releaseCommitSubject(bundle.nextVersion) ||
    pr.headSha !== ownership.branchHead ||
    JSON.stringify(pr.ownership) !== JSON.stringify(ownership)
  ) {
    throw new ReleaseApplyConflictError(
      "Release pull request was not confirmed.",
    );
  }
}

async function summary(
  environment: ReleaseEnvironment,
  version: string,
  releaseSha: string,
): Promise<void> {
  const path = environment.get("GITHUB_STEP_SUMMARY");
  if (path) {
    await Deno.writeTextFile(
      path,
      `## Release ${version}\n\nRelease \`${releaseSha}\`.\n`,
      { append: true },
    );
  }
}
