/** @module Guarded plans for Deno formatting configuration. */
import { legacyFormatChanges, legacyFormatTasks } from "./deno-fmt-commands.ts";

import { formatExclusionChanges } from "./deno-fmt-exclusions.ts";
import type { ChangePlan } from "../api/change-plan.ts";
import type { AllowedOperation } from "../api/feature-operation.ts";
import type { PlannedChange } from "../api/planned-change.ts";
import type { OperationContext } from "../api/repository-context.ts";
import { sameJson } from "../operations/local-plan-state.ts";
import {
  configuredDenoFmt,
  configuredFormatTasks,
  denoFmtFeatureId,
  inspectDenoFmt,
} from "./deno-fmt-inspection.ts";
import {
  denoFmtConfigText,
  denoTaskDefinitions,
  denoTaskNames,
  desiredPublishCheck,
  desiredReadmeBuild,
  desiredTaskIds,
  isReadmeTask,
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
    if (!await configuredDenoFmt(context, state)) {
      changes.push(
        ...formatExclusionChanges(state.config.path, state.config.value),
      );
    }
    if (tasks.kind === "missing-tasks") {
      changes.push({
        kind: "set-json",
        path: state.config.path,
        jsonPath: ["tasks"],
        value: (await initialDenoConfig(
          context,
          state.config.value,
          denoFmtFeatureId,
        )).tasks!,
        expected: undefined,
      });
    } else if (tasks.kind === "tasks") {
      const formattingRepair = legacyFormatTasks(tasks.values).length > 0 ||
        await configuredFormatTasks(context, tasks.values);
      if (formattingRepair) {
        changes.push(...legacyFormatChanges(state.config.path, tasks.values));
        for (const name of ["fmt", "format"]) {
          if (tasks.values[name] === undefined) {
            changes.push({
              kind: "set-json",
              path: state.config.path,
              jsonPath: ["tasks", name],
              value: denoTaskDefinitions()[name],
              expected: undefined,
            });
          }
        }
      }

      const definitions = denoTaskDefinitions(
        desiredTaskIds(context, tasks.values),
        desiredReadmeBuild(context, tasks.values),
        desiredPublishCheck(context, tasks.values),
      );
      const aggregateChanges = formattingRepair
        ? []
        : [...tasks.missing, ...tasks.drifted].sort();
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
          readme.enabled && !isReadmeTask(tasks.values.readme)
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
            expected: tasks.values.readme,
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
    {
      ...allowed,
      preconditions: [
        ...allowed.preconditions,
        ...changes.flatMap((change) =>
          change.kind === "set-json" || change.kind === "remove-json"
            ? [{
              kind: "json-value" as const,
              path: change.path,
              jsonPath: change.jsonPath,
              expected: change.expected,
            }]
            : []
        ),
      ],
    },
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
          expected: tasks.values.readme,
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
