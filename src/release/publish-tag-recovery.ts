/** Recovery-only tag, branch, and event decisions. Validation precedes this module. */

import { type ReleaseOwnership, releaseOwnershipMarker } from "./release-pr.ts";
import { releaseBranch } from "./names.ts";
import { ReleaseApplyConflictError } from "./apply-types.ts";
import { parseSemver } from "./semver.ts";

export type RecoveryGithub = {
  readTag(tag: string): Promise<string | undefined>;
  pushLightweightTag(tag: string, target: string): Promise<void>;
  readReleaseBranch(): Promise<string | undefined>;
  mergedPullRequestsForReleaseBranch(): Promise<
    readonly { ownership: ReleaseOwnership | undefined }[]
  >;
  deleteReleaseBranchWithLease(
    branch: string,
    sha: string,
  ): Promise<"deleted" | "missing" | "lease-mismatch">;
  sendSuccessEvent(
    payload: { schema: 1; version: string; tag: string; releaseSha: string },
  ): Promise<void>;
};

export async function recoverPublishedTag(
  github: RecoveryGithub,
  input: { version: string; releaseSha: string; ownership: ReleaseOwnership },
): Promise<void> {
  validateRecoveryInput(input);
  const tag = await github.readTag(input.version);
  if (tag !== undefined && tag !== input.releaseSha) {
    throw new ReleaseApplyConflictError("Recovery tag has another target.");
  }
  if (tag === undefined) {
    try {
      await github.pushLightweightTag(input.version, input.releaseSha);
    } catch {
      if (await github.readTag(input.version) !== input.releaseSha) {
        throw new ReleaseApplyConflictError("Recovery tag was not created.");
      }
    }
  }
  if (await github.readTag(input.version) !== input.releaseSha) {
    throw new ReleaseApplyConflictError("Recovery tag target changed.");
  }
  const branch = await github.readReleaseBranch();
  if (branch !== undefined) {
    const pullRequests = await github.mergedPullRequestsForReleaseBranch();
    if (
      branch !== input.ownership.branchHead || pullRequests.length !== 1 ||
      JSON.stringify(pullRequests[0].ownership) !==
        JSON.stringify(input.ownership)
    ) {
      throw new ReleaseApplyConflictError("Recovery branch ownership differs.");
    }
    const deleted = await github.deleteReleaseBranchWithLease(
      releaseBranch(input.version),
      branch,
    );
    if (deleted === "lease-mismatch") {
      throw new ReleaseApplyConflictError("Recovery branch lease changed.");
    }
  }
  if (await github.readReleaseBranch() !== undefined) {
    throw new ReleaseApplyConflictError("Recovery branch remains.");
  }
  await github.sendSuccessEvent({
    schema: 1,
    version: input.version,
    tag: input.version,
    releaseSha: input.releaseSha,
  });
}

function validateRecoveryInput(input: {
  version: string;
  releaseSha: string;
  ownership: ReleaseOwnership;
}): void {
  if (
    !parseSemver(input.version) || input.ownership.version !== input.version ||
    !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(input.releaseSha)
  ) {
    throw new TypeError("Release recovery input is invalid.");
  }
  releaseOwnershipMarker(input.ownership);
}
