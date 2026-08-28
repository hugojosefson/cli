/** @module Guarded local operations for the JSR release workflow. */

import type { OperationCheck } from "../api/feature-operation.ts";
import type { OperationContext } from "../api/repository-context.ts";
import {
  inspectJsrReleaseArtifact,
  jsrReleaseFeatureId,
  jsrReleaseMarker,
  jsrReleaseSubject,
} from "./jsr-release-artifacts.ts";

export async function checkEnableJsrRelease(
  context: OperationContext,
): Promise<OperationCheck> {
  for (const path of [".github", ".github/workflows"]) {
    const entry = await context.files.observe(path);
    if (entry.kind !== "absent" && entry.kind !== "directory") {
      return blocked(`Workflow parent ${path} is not a directory.`);
    }
  }
  const artifact = await inspectJsrReleaseArtifact(context);
  if (artifact.result === "matches") {
    return noOp("JSR release workflow is already adopted.");
  }
  const custom = artifact.result === "unreadable" ||
    artifact.result === "differs" &&
      (artifact.observation.kind !== "file" ||
        !artifact.observation.content.startsWith(jsrReleaseMarker));
  if (custom) {
    return blocked(
      "The JSR release workflow is custom and will not be replaced.",
    );
  }
  if (artifact.result !== "absent" && !repairJsrReleaseSelected(context)) {
    return blocked(
      "Generated JSR release workflow differs. Re-run with --repair to restore it.",
    );
  }
  return allowed();
}

export async function checkDisableJsrRelease(
  context: OperationContext,
): Promise<OperationCheck> {
  const artifact = await inspectJsrReleaseArtifact(context);
  if (artifact.result === "absent") {
    return noOp("JSR release workflow is absent.");
  }
  return artifact.result === "matches"
    ? allowed()
    : blocked("Only the exact generated JSR release workflow can be removed.");
}

export function repairJsrReleaseSelected(context: OperationContext): boolean {
  return context.repair?.kind === "all-drifted" ||
    context.repair?.kind === "features" &&
      context.repair.featureIds.includes(jsrReleaseFeatureId);
}
function allowed(): OperationCheck {
  return { result: "allowed", warnings: [], preconditions: [] };
}
function noOp(reason: string): OperationCheck {
  return { result: "no-op", reason, warnings: [] };
}
function blocked(message: string): OperationCheck {
  return {
    result: "blocked",
    blockers: [{
      code: "jsr-release-conflict",
      message,
      subjects: [jsrReleaseSubject()],
      resolution:
        "Keep the custom workflow or use --repair for marked generated drift.",
    }],
    warnings: [],
  };
}
