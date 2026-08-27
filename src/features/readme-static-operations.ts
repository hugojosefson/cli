/** @module Exact starter README checks and plans. */

import type { ChangePlan } from "../api/change-plan.ts";
import type {
  AllowedOperation,
  OperationCheck,
} from "../api/feature-operation.ts";
import type { OperationContext } from "../api/repository-context.ts";
import {
  planArtifactCreation,
  planArtifactRemoval,
} from "../artifacts/plan-artifact-change.ts";
import {
  inspectReadmeStatic,
  readmeStaticBlocker,
  readmeStaticFeatureId,
  readmeStaticPath,
} from "./readme-static-artifact.ts";
import {
  checkRepairReadmeStatic,
  planRepairReadmeStatic,
} from "./readme-static-repair.ts";

export async function checkEnableReadmeStatic(
  context: OperationContext,
): Promise<OperationCheck> {
  const inspection = await inspectReadmeStatic(context);
  if (replacesBuild(context)) return allowed();
  if (
    inspection.result !== "absent" && inspection.result !== "unreadable" &&
    inspection.observation.kind === "file" &&
    (inspection.observation.mode & 0o200) !== 0
  ) {
    return {
      result: "no-op",
      reason: "README.md is already writable.",
      warnings: [],
    };
  }
  const repair = checkRepairReadmeStatic(context, inspection);
  if (repair) return repair;
  const plan = planArtifactCreation(inspection);
  if (plan.result === "planned") {
    return {
      result: "allowed",
      warnings: [],
      preconditions: [{
        kind: "file-digest",
        path: readmeStaticPath,
        digest: undefined,
      }],
    };
  }
  if (plan.result === "no-op") {
    return {
      result: "no-op",
      reason: "README.md is already adopted.",
      warnings: [],
    };
  }
  return {
    result: "blocked",
    blockers: [readmeStaticBlocker(inspection)],
    warnings: [],
  };
}

export async function checkDisableReadmeStatic(
  context: OperationContext,
): Promise<OperationCheck> {
  if (replacedByBuild(context)) return allowed();
  const inspection = await inspectReadmeStatic(context);
  if (
    inspection.result === "differs" && inspection.observation.kind === "file" &&
    (inspection.observation.mode & 0o200) !== 0
  ) {
    return {
      result: "no-op",
      reason: "Preserve the writable README.md.",
      warnings: [],
    };
  }
  const plan = planArtifactRemoval(inspection, "owned");
  if (plan.result === "planned") {
    const change = plan.changes[0];
    if (change.kind !== "remove-file") {
      throw new Error("Starter README must be a file.");
    }
    return {
      result: "allowed",
      warnings: [],
      preconditions: [{
        kind: "file-digest",
        path: readmeStaticPath,
        digest: change.expectedDigest,
      }],
    };
  }
  if (plan.result === "no-op") {
    return {
      result: "no-op",
      reason: "README.md is already absent.",
      warnings: [],
    };
  }
  return {
    result: "blocked",
    blockers: [readmeStaticBlocker(inspection)],
    warnings: [],
  };
}

export async function planEnableReadmeStatic(
  context: OperationContext,
  allowed: AllowedOperation,
): Promise<ChangePlan> {
  if (replacesBuild(context)) return changePlan("enable", allowed, []);
  const plan = planArtifactCreation(await inspectReadmeStatic(context));
  const repair = await planRepairReadmeStatic(context, allowed);
  if (repair) return repair;
  if (plan.result !== "planned") {
    throw new Error("README.md cannot be created.");
  }
  return changePlan("enable", allowed, plan.changes);
}

export async function planDisableReadmeStatic(
  context: OperationContext,
  allowed: AllowedOperation,
): Promise<ChangePlan> {
  if (replacedByBuild(context)) return changePlan("disable", allowed, []);
  const plan = planArtifactRemoval(await inspectReadmeStatic(context), "owned");
  if (plan.result !== "planned") {
    throw new Error("README.md cannot be removed.");
  }
  return changePlan("disable", allowed, plan.changes);
}

function replacedByBuild(context: OperationContext): boolean {
  return context.resolvedChanges.some((change) =>
    change.featureId === "readme-build" && change.enabled
  );
}

function replacesBuild(context: OperationContext): boolean {
  return context.resolvedChanges.some((change) =>
    change.featureId === "readme-build" && !change.enabled
  );
}

function allowed(): OperationCheck {
  return { result: "allowed", warnings: [], preconditions: [] };
}

function changePlan(
  action: "enable" | "disable",
  allowed: AllowedOperation,
  changes: ChangePlan["changes"],
): ChangePlan {
  return {
    featureId: readmeStaticFeatureId,
    action,
    summary: action === "enable"
      ? "Create the exact starter README.md."
      : "Remove the adopted exact starter README.md.",
    warnings: allowed.warnings,
    preconditions: allowed.preconditions,
    changes,
    validations: [{
      kind: "feature-redetection",
      featureId: readmeStaticFeatureId,
      expected: action === "enable" ? "enabled" : "disabled",
    }],
  };
}
