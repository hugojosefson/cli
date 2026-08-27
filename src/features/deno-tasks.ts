/** @module Deno task definitions and pure task inspection. */

import type { JsonObject, JsonValue } from "../api/json.ts";
import type { OperationContext } from "../api/repository-context.ts";
import { sameJson } from "../operations/local-plan-state.ts";

export const taskFeatureIds = [
  "deno-lint",
  "deno-typecheck",
  "deno-test",
] as const;
export type TaskFeatureId = typeof taskFeatureIds[number];

export const leafTaskDefinitions: Readonly<Record<TaskFeatureId, JsonObject>> =
  {
    "deno-lint": {
      description: "Fix lint locally; check lint in CI.",
      command:
        "sh -c 'if test -n \"${CI:-}\"; then exec deno lint; else exec deno lint --fix; fi'",
    },
    "deno-typecheck": {
      description: "Type-check the project.",
      command: "deno check",
    },
    "deno-test": {
      description: "Run tests.",
      command: "deno test --parallel --trace-leaks",
    },
  };

export const leafTaskNames: Readonly<Record<TaskFeatureId, string>> = {
  "deno-lint": "lint",
  "deno-typecheck": "typecheck",
  "deno-test": "test",
};

/** Returns formatter-owned tasks for the enabled task-feature subset. */
export function denoTaskDefinitions(
  enabled: readonly TaskFeatureId[] = [],
): Readonly<Record<string, JsonObject>> {
  const dependencies = ["format", ...enabled.map((id) => leafTaskNames[id])];
  return {
    fmt: { description: "Fix formatting.", command: "deno fmt" },
    format: { description: "Check formatting.", command: "deno fmt --check" },
    check: { description: "Run project checks.", dependencies },
    default: {
      description: "Fix formatting, then run checks.",
      command: "deno fmt && deno task check",
    },
    all: { description: "Run all checks.", dependencies: ["check"] },
  };
}

export const denoTaskNames = Object.keys(denoTaskDefinitions());

/** Returns contributed task IDs whose task key exists, even when drifted. */
export function presentTaskIds(tasks: JsonObject): TaskFeatureId[] {
  return taskFeatureIds.filter((id) => tasks[leafTaskNames[id]] !== undefined);
}

/** Applies all resolved task transitions to currently present task keys. */
export function desiredTaskIds(
  context: OperationContext,
  tasks: JsonObject,
): TaskFeatureId[] {
  const desired = presentTaskIds(tasks);
  for (const change of context.resolvedChanges) {
    if (!taskFeatureIds.includes(change.featureId as TaskFeatureId)) continue;
    const id = change.featureId as TaskFeatureId;
    const index = desired.indexOf(id);
    if (change.enabled && index < 0) desired.push(id);
    if (!change.enabled && index >= 0) desired.splice(index, 1);
  }
  return taskFeatureIds.filter((id) => desired.includes(id));
}

export type DenoTaskInspection =
  | { readonly kind: "missing-tasks" }
  | { readonly kind: "ambiguous-tasks" }
  | {
    readonly kind: "tasks";
    readonly values: JsonObject;
    readonly missing: readonly string[];
    readonly drifted: readonly string[];
    readonly ambiguous: readonly string[];
  };

/** Classifies contributed tasks without inspecting the filesystem. */
export function inspectDenoTasks(config: JsonObject): DenoTaskInspection {
  const tasks = config.tasks;
  if (tasks === undefined) return { kind: "missing-tasks" };
  if (!isObject(tasks)) return { kind: "ambiguous-tasks" };
  const missing: string[] = [];
  const drifted: string[] = [];
  const ambiguous: string[] = [];
  const enabled = presentTaskIds(tasks);
  const definitions = denoTaskDefinitions(enabled);
  for (const name of denoTaskNames) {
    const actual = tasks[name];
    if (actual === undefined) {
      missing.push(name);
    } else if (!isObject(actual)) {
      ambiguous.push(name);
    } else if (!sameJson(actual, definitions[name])) {
      drifted.push(name);
    }
  }
  return { kind: "tasks", values: tasks, missing, drifted, ambiguous };
}

export function isObject(value: JsonValue): value is JsonObject {
  return value !== null && !Array.isArray(value) && typeof value === "object";
}

/** Returns canonical Deno configuration text for the supplied definitions. */
export function denoFmtConfigText(
  config: JsonObject = { tasks: denoTaskDefinitions() },
): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}
