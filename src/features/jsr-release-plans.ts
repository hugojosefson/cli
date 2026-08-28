/** @module Guarded local plans for the JSR release workflow. */

import type { ChangePlan } from "../api/change-plan.ts";
import type { AllowedOperation } from "../api/feature-operation.ts";
import type { PlannedChange } from "../api/planned-change.ts";
import type { OperationContext } from "../api/repository-context.ts";
import {
  inspectJsrReleaseArtifact,
  jsrReleaseArtifact,
  jsrReleaseFeatureId,
  jsrReleaseMarker,
} from "./jsr-release-artifacts.ts";
import {
  checkDisableJsrRelease,
  checkEnableJsrRelease,
  repairJsrReleaseSelected,
} from "./jsr-release-operations.ts";

export async function planEnableJsrRelease(
  context: OperationContext,
  operation: AllowedOperation,
): Promise<ChangePlan> {
  const fresh = await checkEnableJsrRelease(context);
  if (fresh.result === "blocked") {
    throw new Error("JSR release workflow changed after checking.");
  }
  const changes: PlannedChange[] = [];
  if (fresh.result === "allowed") {
    for (const path of [".github", ".github/workflows"]) {
      if ((await context.files.observe(path)).kind === "absent") {
        changes.push({ kind: "create-directory", path });
      }
    }
    const artifact = await inspectJsrReleaseArtifact(context);
    const markedDrift = artifact.result === "differs" &&
      artifact.observation.kind === "file" &&
      artifact.observation.content.startsWith(jsrReleaseMarker);
    if (
      artifact.result === "unreadable" ||
      artifact.result === "differs" &&
        (!markedDrift || !repairJsrReleaseSelected(context))
    ) {
      throw new Error("JSR release workflow changed after checking.");
    }
    if (artifact.result !== "matches") {
      changes.push({
        kind: "write-file",
        path: jsrReleaseArtifact.path,
        content: jsrReleaseArtifact.content,
        mode: 0o644,
        expectedDigest:
          artifact.result === "differs" && artifact.observation.kind === "file"
            ? artifact.observation.digest
            : undefined,
      });
    }
  }
  return plan(
    "enable",
    operation,
    changes,
    "Configure JSR release workflow.",
    "enabled",
  );
}

export async function planDisableJsrRelease(
  context: OperationContext,
  operation: AllowedOperation,
): Promise<ChangePlan> {
  const fresh = await checkDisableJsrRelease(context);
  if (fresh.result === "blocked") {
    throw new Error("JSR release workflow changed after checking.");
  }
  const artifact = await inspectJsrReleaseArtifact(context);
  const changes: PlannedChange[] = fresh.result === "allowed" &&
      artifact.result === "matches" && artifact.observation.kind === "file"
    ? [{
      kind: "remove-file",
      path: artifact.schema.path,
      expectedDigest: artifact.observation.digest,
    }]
    : [];
  return plan(
    "disable",
    operation,
    changes,
    "Remove generated JSR release workflow.",
    "disabled",
  );
}

function plan(
  action: "enable" | "disable",
  operation: AllowedOperation,
  changes: readonly PlannedChange[],
  summary: string,
  expected: "enabled" | "disabled",
): ChangePlan {
  return {
    featureId: jsrReleaseFeatureId,
    action,
    summary,
    warnings: operation.warnings,
    preconditions: operation.preconditions,
    changes,
    validations: [{
      kind: "feature-redetection",
      featureId: jsrReleaseFeatureId,
      expected,
    }],
  };
}
