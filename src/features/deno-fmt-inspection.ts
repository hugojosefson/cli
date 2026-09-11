/** @module Shared inspection for Deno formatting configuration. */

import { configuredDenoTask } from "./configured-deno-task.ts";
import { isObject } from "./deno-tasks.ts";
import type { DenoConfigInspection } from "./deno-config.ts";
import { inspectDenoConfig } from "./deno-config.ts";
import type { DenoTaskInspection } from "./deno-tasks.ts";
import { inspectDenoTasks } from "./deno-tasks.ts";
import type { DetectionContext } from "../api/repository-context.ts";

export const denoFmtFeatureId = "deno-fmt";

export type DenoFmtInspection =
  | {
    readonly config: Extract<DenoConfigInspection, { readonly kind: "config" }>;
    readonly tasks: DenoTaskInspection;
  }
  | {
    readonly config: Exclude<DenoConfigInspection, { readonly kind: "config" }>;
    readonly tasks: undefined;
  };

export function denoFmtSubject() {
  return { kind: "repository-path", identifier: "deno.json|deno.jsonc" };
}

/** Reads the selected config and classifies the contributed tasks. */
export async function inspectDenoFmt(
  context: DetectionContext,
): Promise<DenoFmtInspection> {
  const config = await inspectDenoConfig(context);
  if (config.kind !== "config") return { config, tasks: undefined };
  return { config, tasks: inspectDenoTasks(config.value) };
}

/** Formatting is configured independently of generated aggregate task names. */
export async function configuredDenoFmt(
  context: DetectionContext,
  state: DenoFmtInspection,
): Promise<boolean> {
  if (state.config.kind !== "config" || !isObject(state.config.value.tasks)) {
    return false;
  }
  const tasks = state.config.value.tasks;
  return await configuredDenoTask(context, tasks, "fmt", "fmt") &&
    await configuredDenoTask(context, tasks, "format", "fmt");
}
