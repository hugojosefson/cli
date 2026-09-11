/** @module Stable names owned by release publication. */

export const githubReleasePublishTagFeatureId = "github-release-publish-tag";
export const githubReleasePublishJsrFeatureId = "github-release-publish-jsr";
export const githubReleasePublishGithubFeatureId =
  "github-release-publish-github";
export const githubReleasePublishNpmFeatureId = "github-release-publish-npm";

export const publishTagPrepareCommand = "release publish-tag-prepare";
export const publishTagApplyCommand = "release publish-tag-apply";
export const publishJsrCommand = "release publish-jsr";
export const publishGithubCommand = "release publish-github";
export const publishNpmCommand = "release publish-npm";

export const publishTagWorkflow =
  ".github/workflows/hj-release-publish-tag.yaml";
export const publishJsrWorkflow =
  ".github/workflows/hj-release-publish-jsr.yaml";
export const publishGithubWorkflow =
  ".github/workflows/hj-release-publish-github.yaml";
export const publishNpmWorkflow =
  ".github/workflows/hj-release-publish-npm.yaml";

export const publishTagSuccessEvent = "hj-release-publish-tag-success";
export const releaseBranchPrefix = "release-";
export const releaseCommitSubjectPrefix = "chore(release): ";

export function releaseBranch(version: string): string {
  return `${releaseBranchPrefix}${version}`;
}

export function releaseCommitSubject(version: string): string {
  return `${releaseCommitSubjectPrefix}${version}`;
}
