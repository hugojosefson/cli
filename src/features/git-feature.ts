/** @module Built-in Git repository feature. */

import type { ChangePlan } from "../api/change-plan.ts";
import type { Feature } from "../api/feature.ts";
import type {
  AllowedOperation,
  OperationCheck,
} from "../api/feature-operation.ts";
import type {
  DetectionContext,
  OperationContext,
} from "../api/repository-context.ts";

const gitFeatureId = "git";

function repositorySubject(context: DetectionContext) {
  return { kind: "repository", identifier: context.repositoryRoot.href };
}

async function detectGit(
  context: DetectionContext,
) {
  const subject = repositorySubject(context);
  if (await context.git.isRepository()) {
    return {
      state: "enabled" as const,
      evidence: [{
        code: "git-repository-detected",
        kind: "git-repository",
        subject,
        observation: "The target is a Git repository.",
      }],
    };
  }
  return {
    state: "disabled" as const,
    evidence: [{
      code: "git-repository-not-detected",
      kind: "git-repository",
      subject,
      observation: "The target is not a Git repository.",
    }],
  };
}

async function checkEnableGit(
  context: OperationContext,
): Promise<OperationCheck> {
  if (await context.git.isRepository()) {
    return {
      result: "no-op",
      reason: "The target is already a Git repository.",
      warnings: [],
    };
  }
  return {
    result: "allowed",
    warnings: [],
    preconditions: [{ kind: "git-repository", exists: false }],
  };
}

function planEnableGit(
  _context: OperationContext,
  allowed: AllowedOperation,
): Promise<ChangePlan> {
  return Promise.resolve({
    featureId: gitFeatureId,
    action: "enable",
    summary: "Initialize the target as a Git repository.",
    warnings: allowed.warnings,
    preconditions: allowed.preconditions,
    changes: [{ kind: "git-init" }],
    validations: [{
      kind: "feature-redetection",
      featureId: gitFeatureId,
      expected: "enabled",
    }],
  });
}

function checkDisableGit(
  context: OperationContext,
): Promise<OperationCheck> {
  return context.git.isRepository().then((isRepository) => {
    if (!isRepository) {
      return {
        result: "no-op" as const,
        reason: "The target is not a Git repository.",
        warnings: [],
      };
    }
    return {
      result: "blocked",
      blockers: [{
        code: "git-disable-is-destructive",
        message:
          "Git repositories cannot be disabled because removing .git is destructive and non-reversible.",
        subjects: [repositorySubject(context)],
        resolution: "Keep Git enabled; do not remove .git.",
      }],
      warnings: [],
    } as const;
  });
}

function planDisableGit(
  _context: OperationContext,
  _allowed: AllowedOperation,
): Promise<ChangePlan> {
  return Promise.reject(new Error("Git cannot be disabled."));
}

/** Detects and initializes a Git repository without ever planning its removal. */
export const gitFeature: Feature = {
  metadata: {
    id: gitFeatureId,
    name: "Git",
    summary: "Initializes the target as a Git repository.",
  },
  dependencies: { requires: [] },
  capabilities: { provides: [], requires: [] },
  detect: detectGit,
  checkEnable: checkEnableGit,
  planEnable: planEnableGit,
  checkDisable: checkDisableGit,
  planDisable: planDisableGit,
};
