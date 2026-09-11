/** @module Fail-closed read-only proof that release workflows can be removed. */

import type { GithubReader } from "../api/repository-context.ts";
import { parseSemver } from "../release/semver.ts";
import {
  releaseBranchPrefix,
  releaseCommitSubjectPrefix,
} from "../release/names.ts";

const completed = new Set(["completed"]);

export async function requirePublisherQuiescence(
  github: GithubReader | undefined,
  workflows: readonly string[],
): Promise<string | undefined> {
  if (!github?.workflowRuns) return "Publisher workflow runs are unavailable.";
  for (const workflow of workflows) {
    const runs = await github.workflowRuns(workflow);
    if (!runs) return `Publisher workflow runs are unavailable: ${workflow}.`;
    if (runs.some((run) => !completed.has(run.status))) {
      return `Publisher workflow is not quiescent: ${workflow}.`;
    }
  }
}

export async function requireTagQuiescence(
  github: GithubReader | undefined,
  workflow: string,
): Promise<string | undefined> {
  if (
    !github?.workflowRuns || !github.openPullRequests || !github.branches ||
    !github.tags || !github.defaultBranchCommits
  ) return "Release lifecycle data is unavailable.";
  const [runs, prs, branches, tags, commits] = await Promise.all([
    github.workflowRuns(workflow),
    github.openPullRequests(),
    github.branches(),
    github.tags(),
    github.defaultBranchCommits(),
  ]);
  if (!runs || !prs || !branches || !tags || !commits) {
    return "Release lifecycle data is unavailable.";
  }
  if (runs.some((run) => !completed.has(run.status))) {
    return "Tag workflow is not quiescent.";
  }
  // A release-* head is reserved even if its title is custom: ownership cannot be proved.
  if (prs.some((pr) => pr.head.startsWith(releaseBranchPrefix))) {
    return "An open reserved release pull request remains.";
  }
  if (branches.some((branch) => branch.name.startsWith(releaseBranchPrefix))) {
    return "A reserved release branch remains.";
  }
  const lightweight = new Map<string, string>();
  const tagNames = new Set<string>();
  for (const tag of tags) {
    if (tagNames.has(tag.name)) return "Release tags are ambiguous.";
    tagNames.add(tag.name);
    if (tag.lightweight) lightweight.set(tag.name, tag.target);
  }
  for (const commit of commits) {
    const match = new RegExp(`^${escape(releaseCommitSubjectPrefix)}(.+)$`)
      .exec(commit.subject);
    if (
      match && parseSemver(match[1]) && lightweight.get(match[1]) !== commit.oid
    ) {
      return `Release commit ${match[1]} has no correct lightweight tag.`;
    }
  }
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
