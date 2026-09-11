/** @module GitHub main-branch and tag-protection features. */

import type { Feature } from "../api/feature.ts";
import type { OperationContext } from "../api/repository-context.ts";
import { githubCiArtifacts } from "./github-ci-artifacts.ts";
import {
  mainProtectionDefinition,
  mainReviewDefinition,
} from "./github-protection-definitions.ts";
import { rulesetFeature } from "./github-protection-lifecycle.ts";
export { githubProtectedTagsFeature } from "./github-protected-tags-lifecycle.ts";

const mainProtectionFeature = rulesetFeature(
  "github-main-protection",
  "default branch protection",
  [mainProtectionDefinition],
  [{
    featureId: "github-ci",
    reason: "Main protection requires generated GitHub CI.",
  }],
);
export const githubMainProtectionFeature: Feature = {
  ...mainProtectionFeature,
  checkEnable: async (context) =>
    await checkMainProtectionEnable(context, mainProtectionFeature),
  planEnable: async (context, operation) => {
    const expectedRemote = remoteCiPrecondition();
    const remotePreconditions = operation.preconditions.filter((condition) =>
      condition.kind === "github-remote-file"
    );
    const remote = await context.github?.remoteFile?.(expectedRemote.path);
    if (
      JSON.stringify(remotePreconditions) !==
        JSON.stringify([expectedRemote]) ||
      remote?.kind !== "file" ||
      remote.content !== expectedRemote.expectedContent
    ) {
      throw new Error("The remote CI workflow changed after check.");
    }
    const plan = await mainProtectionFeature.planEnable(context, {
      ...operation,
      preconditions: operation.preconditions.filter((condition) =>
        condition.kind !== "github-remote-file"
      ),
    });
    return {
      ...plan,
      preconditions: [...plan.preconditions, expectedRemote],
      validations: [...plan.validations, { kind: "github-main-protection" }],
    };
  },
};
const mainReviewFeature = rulesetFeature(
  "github-main-review",
  "strict main reviews",
  [mainReviewDefinition],
  [{
    featureId: "github-main-protection",
    reason: "Strict reviews layer on main protection.",
  }],
);
export const githubMainReviewFeature: Feature = {
  ...mainReviewFeature,
  conflicts: { featureIds: ["github-release-publish-tag"] },
  capabilities: { provides: [], requires: [] },
};

async function checkMainProtectionEnable(
  context: OperationContext,
  feature: Feature,
) {
  const check = await feature.checkEnable(context);
  if (check.result !== "allowed") return check;
  const artifact = githubCiArtifacts[0];
  const remote = await context.github?.remoteFile?.(artifact.path);
  if (remote?.kind === "file" && remote.content === artifact.content) {
    return {
      ...check,
      preconditions: [...check.preconditions, remoteCiPrecondition()],
    };
  }
  return {
    result: "blocked" as const,
    blockers: [{
      code: "github-remote-ci-missing",
      message:
        "The remote default branch does not have the exact generated CI workflow.",
      subjects: [],
      resolution:
        "Enable or repair github-ci, merge its workflow, and start this operation again.",
    }],
    warnings: [],
  };
}

function remoteCiPrecondition() {
  const artifact = githubCiArtifacts[0];
  return {
    kind: "github-remote-file" as const,
    path: artifact.path,
    expectedContent: artifact.content,
  };
}
