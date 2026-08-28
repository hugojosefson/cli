/** @module Guarded plans for Deno formatting configuration. */

import type { ChangePlan } from "../api/change-plan.ts";
import type { AllowedOperation } from "../api/feature-operation.ts";
import type { PlannedChange } from "../api/planned-change.ts";
import type { OperationContext } from "../api/repository-context.ts";
import { sameJson } from "../operations/local-plan-state.ts";
import { denoFmtFeatureId, inspectDenoFmt } from "./deno-fmt-inspection.ts";
import {
  denoFmtConfigText,
  denoTaskDefinitions,
  denoTaskNames,
  desiredPublishCheck,
  desiredReadmeBuild,
  desiredTaskIds,
  presentTaskIds,
  readmeTaskDefinition,
} from "./deno-tasks.ts";
import {
  createsInitialDenoConfig,
  initialDenoConfig,
} from "./deno-initial-config.ts";

/** Plans creation, completion, or selected repair of Deno formatting tasks. */
export async function planEnableDenoFmt(
  context: OperationContext,
  allowed: AllowedOperation,
): Promise<ChangePlan> {
  const state = await inspectDenoFmt(context);
  const changes: PlannedChange[] = [];
  if (
    state.config.kind === "absent" &&
    createsInitialDenoConfig(context, denoFmtFeatureId)
  ) {
    changes.push({
      kind: "write-file",
      path: "deno.jsonc",
      content: denoFmtConfigText(
        await initialDenoConfig(context, {}, denoFmtFeatureId),
      ),
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
        value: (await initialDenoConfig(context, {}, denoFmtFeatureId)).tasks!,
        expected: undefined,
      });
    } else if (tasks.kind === "tasks") {
      const definitions = denoTaskDefinitions(
        desiredTaskIds(context, tasks.values),
        desiredReadmeBuild(context, tasks.values),
        desiredPublishCheck(context, tasks.values),
      );
      const aggregateChanges = [...tasks.missing, ...tasks.drifted].sort();
      for (const name of aggregateChanges) {
        changes.push({
          kind: "set-json",
          path: state.config.path,
          jsonPath: ["tasks", name],
          value: definitions[name],
          expected: tasks.values[name],
        });
      }
      const readme = readmeTransition(context);
      if (readme) {
        if (
          readme.enabled && !sameJson(tasks.values.readme, definitions.readme)
        ) {
          changes.push({
            kind: "set-json",
            path: state.config.path,
            jsonPath: ["tasks", "readme"],
            value: readmeTaskDefinition,
            expected: tasks.values.readme,
          });
        } else if (!readme.enabled && tasks.values.readme !== undefined) {
          changes.push({
            kind: "remove-json",
            path: state.config.path,
            jsonPath: ["tasks", "readme"],
            expected: readmeTaskDefinition,
          });
        }
        if (
          !aggregateChanges.includes("default") &&
          !sameJson(tasks.values.default, definitions.default)
        ) {
          changes.push({
            kind: "set-json",
            path: state.config.path,
            jsonPath: ["tasks", "default"],
            value: definitions.default!,
            expected: tasks.values.default,
          });
        }
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
          expected: denoTaskDefinitions(
            presentTaskIds(tasks.values),
            tasks.values.readme !== undefined,
            tasks.values["publish-check"] !== undefined,
          )[name],
        });
      }
      if (
        readmeTransition(context)?.enabled === false &&
        tasks.values.readme !== undefined
      ) {
        changes.push({
          kind: "remove-json",
          path: state.config.path,
          jsonPath: ["tasks", "readme"],
          expected: readmeTaskDefinition,
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

function readmeTransition(context: OperationContext) {
  return context.resolvedChanges.find((change) =>
    change.featureId === "readme-build"
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
