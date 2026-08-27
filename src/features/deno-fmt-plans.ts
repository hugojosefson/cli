/** @module Guarded plans for Deno formatting configuration. */

import type { ChangePlan } from "../api/change-plan.ts";
import type { AllowedOperation } from "../api/feature-operation.ts";
import type { PlannedChange } from "../api/planned-change.ts";
import type { OperationContext } from "../api/repository-context.ts";
import { denoFmtFeatureId, inspectDenoFmt } from "./deno-fmt-inspection.ts";
import {
  denoFmtConfigText,
  denoTaskDefinitions,
  denoTaskNames,
} from "./deno-tasks.ts";

/** Plans creation, completion, or selected repair of Deno formatting tasks. */
export async function planEnableDenoFmt(
  context: OperationContext,
  allowed: AllowedOperation,
): Promise<ChangePlan> {
  const state = await inspectDenoFmt(context);
  const changes: PlannedChange[] = [];
  if (state.config.kind === "absent") {
    changes.push({
      kind: "write-file",
      path: "deno.jsonc",
      content: denoFmtConfigText(),
      mode: 0o644,
      expectedDigest: undefined,
    });
  } else if (state.config.kind === "config") {
    const tasks = state.tasks!;
    if (tasks.kind === "missing-tasks") {
      changes.push({
        kind: "set-json",
        path: state.config.path,
        jsonPath: ["tasks"],
        value: denoTaskDefinitions,
        expected: undefined,
      });
    } else if (tasks.kind === "tasks") {
      for (const name of [...tasks.missing, ...tasks.drifted].sort()) {
        changes.push({
          kind: "set-json",
          path: state.config.path,
          jsonPath: ["tasks", name],
          value: denoTaskDefinitions[name],
          expected: tasks.values[name],
        });
      }
    }
  }
  return plan(
    "enable",
    allowed,
    changes,
    "Configure Deno formatting tasks.",
    "enabled",
  );
}

/** Plans removal of only exact contributed task definitions. */
export async function planDisableDenoFmt(
  context: OperationContext,
  allowed: AllowedOperation,
): Promise<ChangePlan> {
  const state = await inspectDenoFmt(context);
  const changes: PlannedChange[] = [];
  if (state.config.kind === "config") {
    const tasks = state.tasks!;
    if (state.config.exactStandalone) {
      changes.push({
        kind: "remove-file",
        path: state.config.path,
        expectedDigest: state.config.digest,
      });
    } else if (tasks.kind === "tasks") {
      for (const name of denoTaskNames) {
        if (tasks.missing.includes(name)) continue;
        changes.push({
          kind: "remove-json",
          path: state.config.path,
          jsonPath: ["tasks", name],
          expected: denoTaskDefinitions[name],
        });
      }
    }
  }
  return plan(
    "disable",
    allowed,
    changes,
    "Remove contributed Deno formatting tasks.",
    "disabled",
  );
}

function plan(
  action: "enable" | "disable",
  allowed: AllowedOperation,
  changes: readonly PlannedChange[],
  summary: string,
  expected: "enabled" | "disabled",
): ChangePlan {
  return {
    featureId: denoFmtFeatureId,
    action,
    summary,
    warnings: allowed.warnings,
    preconditions: allowed.preconditions,
    changes,
    validations: [{
      kind: "feature-redetection",
      featureId: denoFmtFeatureId,
      expected,
    }],
  };
}
