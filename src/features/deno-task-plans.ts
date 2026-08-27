/** @module Checks and plans for independent Deno tasks. */

import type { ChangePlan } from "../api/change-plan.ts";
import type {
  AllowedOperation,
  OperationCheck,
} from "../api/feature-operation.ts";
import type { PlannedChange } from "../api/planned-change.ts";
import type { OperationContext } from "../api/repository-context.ts";
import { denoFmtSubject } from "./deno-fmt-inspection.ts";
import { inspectDenoTask } from "./deno-task-inspection.ts";
import {
  denoTaskDefinitions,
  desiredTaskIds,
  leafTaskDefinitions,
  leafTaskNames,
  type TaskFeatureId,
  taskFeatureIds,
} from "./deno-tasks.ts";

export async function checkDenoTask(
  context: OperationContext,
  id: TaskFeatureId,
  enable: boolean,
): Promise<OperationCheck> {
  const state = await inspectDenoTask(context, id);
  if (state.kind === "ambiguous") return blocked(state.message);
  if (state.kind === "tasks" && !state.aggregate && !selected(context, id)) {
    return blocked(
      "The check aggregate conflicts. Re-run with --repair to replace it.",
    );
  }
  if (
    enable && state.kind === "tasks" && !state.exact && state.present &&
    !selected(context, id)
  ) {
    return blocked(
      "Deno task definition conflicts. Re-run with --repair to replace it.",
    );
  }
  if (
    !enable && state.kind === "tasks" && state.present && !state.exact
  ) return blocked("Deno task definition conflicts and cannot be removed.");
  if (
    (enable && state.kind === "tasks" && state.exact && state.aggregate) ||
    (!enable && (!state.exact || state.kind === "absent"))
  ) {
    return {
      result: "no-op",
      reason: "Deno task is already in the requested state.",
      warnings: [],
    };
  }
  return { result: "allowed", warnings: [], preconditions: [] };
}

export async function planDenoTask(
  context: OperationContext,
  allowed: AllowedOperation,
  id: TaskFeatureId,
  enable: boolean,
): Promise<ChangePlan> {
  const state = await inspectDenoTask(context, id);
  const changes: PlannedChange[] = [];
  if (state.kind === "tasks" && state.exact !== enable) {
    if (enable) {
      changes.push({
        kind: "set-json",
        path: state.config.path,
        jsonPath: ["tasks", leafTaskNames[id]],
        value: leafTaskDefinitions[id],
        expected: state.tasks[leafTaskNames[id]],
      });
    } else {
      changes.push({
        kind: "remove-json",
        path: state.config.path,
        jsonPath: ["tasks", leafTaskNames[id]],
        expected: leafTaskDefinitions[id],
      });
    }
  }
  if (state.kind === "tasks" && ownsAggregate(context, id)) {
    const enabled = desiredTaskIds(context, state.tasks);
    changes.push({
      kind: "set-json",
      path: state.config.path,
      jsonPath: ["tasks", "check"],
      value: denoTaskDefinitions(enabled).check,
      expected: state.tasks.check,
    });
  }
  return {
    featureId: id,
    action: enable ? "enable" : "disable",
    summary: "Configure Deno task.",
    warnings: allowed.warnings,
    preconditions: allowed.preconditions,
    changes,
    validations: [{
      kind: "feature-redetection",
      featureId: id,
      expected: enable ? "enabled" : "disabled",
    }],
  };
}

function ownsAggregate(context: OperationContext, id: TaskFeatureId): boolean {
  if (
    context.resolvedChanges.some((change) =>
      change.featureId === "deno-fmt" && !change.enabled
    )
  ) return false;
  if (
    context.resolvedChanges.some((change) =>
      change.featureId === "deno-fmt" && change.enabled
    ) && context.detections.get("deno-fmt")?.state !== "enabled"
  ) return false;
  return context.resolvedChanges.filter((change) =>
    taskFeatureIds.includes(change.featureId as TaskFeatureId)
  ).map((change) => change.featureId).sort()[0] === id;
}
function selected(context: OperationContext, id: string): boolean {
  return context.repair?.kind === "all-drifted" ||
    context.repair?.kind === "features" &&
      context.repair.featureIds.includes(id);
}
function blocked(message: string): OperationCheck {
  return {
    result: "blocked",
    blockers: [{
      code: "deno-task-conflict",
      message,
      subjects: [denoFmtSubject()],
      resolution: "Resolve the conflict or use --repair.",
    }],
    warnings: [],
  };
}
