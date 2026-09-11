/** @module Safe operations for exact GitHub CI workflows. */

import type { ChangePlan } from "../api/change-plan.ts";
import type {
  AllowedOperation,
  OperationCheck,
} from "../api/feature-operation.ts";
import type { PlannedChange } from "../api/planned-change.ts";
import type { OperationContext } from "../api/repository-context.ts";
import {
  githubCiFeatureId,
  githubCiMarker,
  githubCiPermissionName,
  githubCiPermissionResource,
  githubCiSubject,
  inspectGithubCiArtifacts,
} from "./github-ci-artifacts.ts";

export async function checkEnableGithubCi(
  context: OperationContext,
): Promise<OperationCheck> {
  for (const path of [".github", ".github/workflows"]) {
    const entry = await context.files.observe(path);
    if (entry.kind !== "absent" && entry.kind !== "directory") {
      return blocked(`Workflow parent ${path} is not a directory.`);
    }
  }
  const artifacts = await inspectGithubCiArtifacts(context);
  const custom = artifacts.find((item) =>
    item.result === "unreadable" || item.result === "differs" &&
      (item.observation.kind !== "file" ||
        !item.observation.content.startsWith(githubCiMarker))
  );
  if (custom) {
    return blocked("A GitHub workflow is custom and will not be replaced.");
  }
  const drifted = !artifacts.every((item) => item.result === "absent") &&
    !artifacts.every((item) => item.result === "matches");
  if (drifted && !repair(context)) {
    return blocked(
      "Generated GitHub workflows differ. Re-run with --repair to restore them.",
    );
  }
  const permission = await workflowPermission(context);
  if (permission !== true) {
    return blocked(
      permission === false
        ? "GitHub Actions cannot create and approve pull requests."
        : "Cannot read whether GitHub Actions can create and approve pull requests.",
      actionsPermissionResolution,
    );
  }
  return artifacts.every((item) => item.result === "matches")
    ? noOp("GitHub CI workflows are already adopted.")
    : allowed();
}

export async function checkDisableGithubCi(
  context: OperationContext,
): Promise<OperationCheck> {
  const artifacts = await inspectGithubCiArtifacts(context);
  const nonExact = artifacts.find((item) =>
    item.result !== "matches" && item.result !== "absent"
  );
  return nonExact
    ? blocked("Only exact generated GitHub workflows can be removed.")
    : artifacts.every((item) => item.result === "absent")
    ? noOp("GitHub CI workflows are absent.")
    : allowed();
}

export async function planEnableGithubCi(
  context: OperationContext,
  allowedOperation: AllowedOperation,
): Promise<ChangePlan> {
  const artifacts = await inspectGithubCiArtifacts(context);
  const changes: PlannedChange[] = [];
  for (const path of [".github", ".github/workflows"]) {
    if ((await context.files.observe(path)).kind === "absent") {
      changes.push({ kind: "create-directory", path });
    }
  }
  for (const item of artifacts) {
    if (item.result === "matches") continue;
    if (item.schema.kind !== "file") {
      throw new Error("Expected workflow file schema.");
    }
    changes.push({
      kind: "write-file",
      path: item.schema.path,
      content: item.schema.content,
      mode: 0o644,
      expectedDigest:
        item.result === "differs" && item.observation.kind === "file"
          ? item.observation.digest
          : undefined,
    });
  }
  return plan(
    "enable",
    allowedOperation,
    changes,
    "Configure GitHub CI workflows.",
    "enabled",
  );
}

export async function planDisableGithubCi(
  context: OperationContext,
  allowedOperation: AllowedOperation,
): Promise<ChangePlan> {
  const artifacts = await inspectGithubCiArtifacts(context);
  const changes: PlannedChange[] = artifacts.flatMap((item) =>
    item.result === "matches" && item.observation.kind === "file"
      ? [{
        kind: "remove-file" as const,
        path: item.schema.path,
        expectedDigest: item.observation.digest,
      }]
      : []
  );
  return plan(
    "disable",
    allowedOperation,
    changes,
    "Remove generated GitHub CI workflows.",
    "disabled",
  );
}

function repair(context: OperationContext): boolean {
  return context.repair?.kind === "all-drifted" ||
    context.repair?.kind === "features" &&
      context.repair.featureIds.includes(githubCiFeatureId);
}
function allowed(): OperationCheck {
  return { result: "allowed", warnings: [], preconditions: [] };
}
function noOp(reason: string): OperationCheck {
  return { result: "no-op", reason, warnings: [] };
}
const actionsPermissionResolution =
  "Enable “Allow GitHub Actions to create and approve pull requests” under repository Settings > Actions > General.";

async function workflowPermission(
  context: OperationContext,
): Promise<boolean | undefined> {
  const resource = await context.github?.resource(
    githubCiPermissionResource,
    githubCiPermissionName,
  );
  return typeof resource?.definition.value === "boolean"
    ? resource.definition.value
    : undefined;
}

function blocked(message: string, resolution?: string): OperationCheck {
  return {
    result: "blocked",
    blockers: [{
      code: "github-ci-conflict",
      message,
      subjects: [githubCiSubject()],
      resolution: resolution ??
        "Keep the custom workflow or restore the generated workflow with --repair.",
    }],
    warnings: [],
  };
}
function plan(
  action: "enable" | "disable",
  allowedOperation: AllowedOperation,
  changes: readonly PlannedChange[],
  summary: string,
  expected: "enabled" | "disabled",
): ChangePlan {
  return {
    featureId: githubCiFeatureId,
    action,
    summary,
    warnings: allowedOperation.warnings,
    preconditions: allowedOperation.preconditions,
    changes,
    validations: [{
      kind: "feature-redetection",
      featureId: githubCiFeatureId,
      expected,
    }],
  };
}
