/** @module Explicit repair checks and plans for the static README. */

import type { ExactArtifactInspection } from "../api/artifact-inspection.ts";
import type { ChangePlan } from "../api/change-plan.ts";
import type {
  AllowedOperation,
  OperationCheck,
} from "../api/feature-operation.ts";
import type { PlannedChange } from "../api/planned-change.ts";
import type { OperationContext } from "../api/repository-context.ts";
import {
  inspectReadmeStatic,
  readmeStaticFeatureId,
  readmeStaticPath,
} from "./readme-static-artifact.ts";

export function checkRepairReadmeStatic(
  context: OperationContext,
  inspection: ExactArtifactInspection,
): OperationCheck | undefined {
  if (
    !repairSelected(context) || inspection.result !== "differs" ||
    inspection.observation.kind !== "file"
  ) return undefined;
  return {
    result: "allowed",
    warnings: [],
    preconditions: [{
      kind: "file-digest",
      path: readmeStaticPath,
      digest: inspection.observation.digest,
    }],
  };
}

export async function planRepairReadmeStatic(
  context: OperationContext,
  allowed: AllowedOperation,
): Promise<ChangePlan | undefined> {
  const inspection = await inspectReadmeStatic(context);
  if (
    !repairSelected(context) || inspection.result !== "differs" ||
    inspection.observation.kind !== "file" || inspection.schema.kind !== "file"
  ) {
    return undefined;
  }
  const changes: PlannedChange[] = [{
    kind: "write-file",
    path: readmeStaticPath,
    content: inspection.schema.content,
    expectedDigest: inspection.observation.digest,
  }];
  if (inspection.observation.mode !== inspection.schema.mode) {
    changes.push({
      kind: "set-file-mode",
      path: readmeStaticPath,
      mode: inspection.schema.mode,
      expectedMode: inspection.observation.mode,
    });
  }
  return {
    featureId: readmeStaticFeatureId,
    action: "enable",
    summary: "Repair the exact starter README.md.",
    warnings: allowed.warnings,
    preconditions: allowed.preconditions,
    changes,
    validations: [{
      kind: "feature-redetection",
      featureId: readmeStaticFeatureId,
      expected: "enabled",
    }],
  };
}

function repairSelected(context: OperationContext): boolean {
  return context.repair?.kind === "all-drifted" ||
    context.repair?.kind === "features" &&
      context.repair.featureIds.includes(readmeStaticFeatureId);
}
