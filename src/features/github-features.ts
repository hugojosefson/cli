/** @module GitHub repository access and independently managed boolean settings. */

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

const repositorySubject = (context: DetectionContext) => ({
  kind: "repository",
  identifier: context.repositoryRoot.href,
});

async function githubRepository(context: DetectionContext) {
  return await context.github?.repository();
}

async function detectRepo(context: DetectionContext) {
  const repository = await githubRepository(context);
  return repository
    ? {
      state: "enabled" as const,
      evidence: [{
        code: "github-repository-detected",
        kind: "github-repository",
        subject: repositorySubject(context),
        observation: "Authenticated GitHub repository access is available.",
      }],
    }
    : {
      state: "disabled" as const,
      evidence: [{
        code: "github-repository-unavailable",
        kind: "github-repository",
        subject: repositorySubject(context),
        observation: "Authenticated GitHub repository access is unavailable.",
      }],
    };
}

async function checkRepoEnable(
  context: OperationContext,
): Promise<OperationCheck> {
  return await githubRepository(context)
    ? {
      result: "no-op",
      reason: "Authenticated GitHub repository access is available.",
      warnings: [],
    }
    : blocked(
      context,
      "GitHub repository access is required and cannot be created automatically.",
    );
}
function checkRepoDisable(context: OperationContext): Promise<OperationCheck> {
  return Promise.resolve(
    blocked(
      context,
      "GitHub repositories cannot be disabled because deletion is destructive.",
    ),
  );
}
function blocked(context: DetectionContext, message: string): OperationCheck {
  return {
    result: "blocked",
    blockers: [{
      code: "github-repository-unavailable",
      message,
      subjects: [repositorySubject(context)],
      resolution: "Connect an accessible GitHub repository.",
    }],
    warnings: [],
  };
}
function impossible(): Promise<ChangePlan> {
  return Promise.reject(new Error("GitHub repository cannot be changed."));
}

/** Detects access only; this feature never creates or deletes repositories. */
export const githubRepoFeature: Feature = {
  metadata: {
    id: "github-repo",
    name: "GitHub repository",
    summary:
      "Detects authenticated access to the checked-out GitHub repository.",
  },
  dependencies: { requires: [] },
  capabilities: { provides: [], requires: [] },
  detect: detectRepo,
  checkEnable: checkRepoEnable,
  planEnable: impossible,
  checkDisable: checkRepoDisable,
  planDisable: impossible,
};

export interface GithubSetting {
  readonly id: string;
  readonly field: string;
  readonly enabled: boolean;
}
export const githubSettings: readonly GithubSetting[] = [
  { id: "github-auto-merge", field: "allow_auto_merge", enabled: true },
  {
    id: "github-delete-branch-on-merge",
    field: "delete_branch_on_merge",
    enabled: true,
  },
  { id: "github-merge-commit", field: "allow_merge_commit", enabled: false },
  { id: "github-squash-merge", field: "allow_squash_merge", enabled: true },
  { id: "github-rebase-merge", field: "allow_rebase_merge", enabled: true },
  { id: "github-wiki", field: "has_wiki", enabled: false },
  { id: "github-issues", field: "has_issues", enabled: true },
  { id: "github-projects", field: "has_projects", enabled: true },
  { id: "github-discussions", field: "has_discussions", enabled: false },
  { id: "github-update-branch", field: "allow_update_branch", enabled: true },
  {
    id: "github-web-commit-signoff",
    field: "web_commit_signoff_required",
    enabled: false,
  },
  { id: "github-private", field: "private", enabled: true },
];

/** Creates a feature that changes exactly one GitHub repository boolean field. */
export function githubSettingFeature(setting: GithubSetting): Feature {
  const detect = async (context: DetectionContext) => {
    if (!await githubRepository(context)) {
      return { state: "disabled" as const, evidence: [] };
    }
    const resource = await context.github?.resource(
      "repository-setting",
      setting.field,
    );
    const value = resource?.definition.value;
    return typeof value === "boolean"
      ? {
        state: value ? "enabled" as const : "disabled" as const,
        evidence: [{
          code: "github-setting-observed",
          kind: "github-repository-setting",
          subject: repositorySubject(context),
          observation: `${setting.field} is ${value}.`,
        }],
      }
      : {
        state: "ambiguous" as const,
        evidence: [],
        issues: [{
          code: "github-setting-unavailable",
          kind: "github-repository-setting",
          subject: repositorySubject(context),
          observation: `Cannot read ${setting.field}.`,
          resolution: "Authenticate gh for this GitHub repository.",
        }],
      };
  };
  const check =
    (enabled: boolean) =>
    async (context: OperationContext): Promise<OperationCheck> => {
      const resource = await context.github?.resource(
        "repository-setting",
        setting.field,
      );
      if (!resource || typeof resource.definition.value !== "boolean") {
        return blocked(
          context,
          `GitHub setting ${setting.field} is unavailable.`,
        );
      }
      if (resource.definition.value === enabled) {
        return {
          result: "no-op",
          reason:
            `GitHub setting ${setting.field} already has the requested value.`,
          warnings: [],
        };
      }
      return {
        result: "allowed",
        warnings: [{
          code: "github-setting-mutation",
          message: `Change GitHub setting ${setting.field}.`,
          subjects: [repositorySubject(context)],
          requiresConfirmation: true,
        }],
        preconditions: [{
          kind: "github-resource-state",
          resource: "repository-setting",
          name: setting.field,
          stateDigest: resource.stateDigest,
        }],
      };
    };
  const plan = (enabled: boolean) =>
  (
    _context: OperationContext,
    allowed: AllowedOperation,
  ): Promise<ChangePlan> =>
    Promise.resolve({
      featureId: setting.id,
      action: enabled ? "enable" : "disable",
      summary: `Set GitHub ${setting.field} to ${enabled}.`,
      warnings: allowed.warnings,
      preconditions: allowed.preconditions,
      changes: [{
        kind: "upsert-github-resource",
        resource: "repository-setting",
        name: setting.field,
        definition: { value: enabled },
        expectedStateDigest: allowed.preconditions.find((item) =>
          item.kind === "github-resource-state"
        )!.stateDigest,
      }],
      validations: [{
        kind: "feature-redetection",
        featureId: setting.id,
        expected: enabled ? "enabled" : "disabled",
      }],
    });
  return {
    metadata: {
      id: setting.id,
      name: setting.id,
      summary: `Sets GitHub ${setting.field}.`,
    },
    dependencies: {
      requires: [{
        featureId: "github-repo",
        reason: "GitHub repository access is required.",
      }],
    },
    capabilities: { provides: [], requires: [] },
    detect,
    checkEnable: check(true),
    planEnable: plan(true),
    checkDisable: check(false),
    planDisable: plan(false),
  };
}
