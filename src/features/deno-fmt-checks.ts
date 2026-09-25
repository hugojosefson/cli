/** @module Safety checks for Deno formatting changes. */
import { customFormatIgnores, legacyFormatTasks } from "./deno-fmt-commands.ts";

import {
  formatExclusionError,
  missingFormatExclusion,
} from "./deno-fmt-exclusions.ts";
import { configuredDenoTask } from "./configured-deno-task.ts";
import type {
  OperationBlocker,
  OperationCheck,
} from "../api/feature-operation.ts";
import type { OperationContext } from "../api/repository-context.ts";
import {
  configuredDenoFmt,
  configuredFormatTasks,
  denoFmtFeatureId,
  denoFmtSubject,
  inspectDenoFmt,
} from "./deno-fmt-inspection.ts";
import { denoTaskNames } from "./deno-tasks.ts";

/** Checks whether the feature can add missing tasks or repair selected drift. */
export async function checkEnableDenoFmt(
  context: OperationContext,
): Promise<OperationCheck> {
  const state = await inspectDenoFmt(context);
  if (await configuredDenoFmt(context, state)) {
    if (
      context.resolvedChanges.some((change) =>
        change.featureId === "readme-build"
      )
    ) return allowed();
    return {
      result: "no-op",
      reason: "Deno formatting is already configured.",
      warnings: [],
    };
  }
  if (state.config.kind === "absent") return allowed();
  if (state.config.kind === "ambiguous") {
    return blocked(state.config.observation);
  }
  const exclusionError = formatExclusionError(state.config.value);
  if (exclusionError) {
    return blocked(exclusionError);
  }
  const tasks = state.tasks!;
  if (tasks.kind === "missing-tasks") return allowed();
  if (tasks.kind === "ambiguous-tasks") {
    return blocked("The Deno tasks entry is not an object.");
  }
  if (customFormatIgnores(tasks.values).length > 0) {
    return blocked(
      "Move custom --ignore arguments to fmt.exclude manually. Automatic command repair is unsupported.",
    );
  }
  if (legacyFormatTasks(tasks.values).length > 0) {
    for (const name of ["fmt", "format"]) {
      if (
        tasks.values[name] !== undefined &&
        !await configuredDenoTask(context, tasks.values, name, "fmt")
      ) {
        return blocked(
          `Correct tasks.${name} manually before moving formatting exclusions.`,
        );
      }
    }
    return repairSelected(context) ? allowed() : blocked(
      "Move coverage from the generated --ignore arguments to fmt.exclude with --repair.",
    );
  }
  if (
    missingFormatExclusion(state.config.value) &&
    await configuredFormatTasks(context, tasks.values)
  ) {
    return allowed();
  }
  if (tasks.ambiguous.length > 0) {
    return blocked(`Deno task ${tasks.ambiguous[0]} is not an object.`);
  }
  if (tasks.drifted.length > 0 && !repairSelected(context)) {
    return blocked(
      "Contributed Deno task definitions conflict. Re-run with --repair to replace them.",
    );
  }
  if (
    tasks.missing.length > 0 || tasks.drifted.length > 0 ||
    missingFormatExclusion(state.config.value)
  ) return allowed();
  return {
    result: "no-op",
    reason: "Deno formatting tasks are already adopted.",
    warnings: [],
  };
}

/** Checks whether only exact contributed definitions will be removed. */
export async function checkDisableDenoFmt(
  context: OperationContext,
): Promise<OperationCheck> {
  const state = await inspectDenoFmt(context);
  if (state.config.kind === "absent") return noTasks();
  if (state.config.kind === "ambiguous") {
    return blocked(state.config.observation);
  }
  const tasks = state.tasks!;
  if (tasks.kind === "missing-tasks") return noTasks();
  if (tasks.kind === "ambiguous-tasks") {
    return blocked("The Deno tasks entry is not an object.");
  }
  if (tasks.ambiguous.length > 0) {
    return blocked(`Deno task ${tasks.ambiguous[0]} is not an object.`);
  }
  if (tasks.drifted.length > 0) {
    return blocked(
      "Contributed Deno task definitions conflict and cannot be removed.",
    );
  }
  if (tasks.missing.length === denoTaskNames.length) return noTasks();
  return allowed();
}

function allowed(): OperationCheck {
  return { result: "allowed", warnings: [], preconditions: [] };
}

function noTasks(): OperationCheck {
  return {
    result: "no-op",
    reason: "Deno formatting tasks are absent.",
    warnings: [],
  };
}

function blocked(message: string): OperationCheck {
  const blocker: OperationBlocker = {
    code: "deno-fmt-conflict",
    message,
    subjects: [denoFmtSubject()],
    resolution:
      "Resolve the conflict or use --repair for contributed task definitions.",
  };
  return { result: "blocked", blockers: [blocker], warnings: [] };
}

function repairSelected(context: OperationContext): boolean {
  return context.repair?.kind === "all-drifted" ||
    context.repair?.kind === "features" &&
      context.repair.featureIds.includes(denoFmtFeatureId);
}
