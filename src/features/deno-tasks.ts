/** @module Deno task definitions and pure task inspection. */

import type { JsonObject, JsonValue } from "../api/json.ts";
import { sameJson } from "../operations/local-plan-state.ts";

export const denoTaskDefinitions: Readonly<Record<string, JsonObject>> = {
  fmt: { description: "Fix formatting.", command: "deno fmt" },
  format: { description: "Check formatting.", command: "deno fmt --check" },
  check: { description: "Run read-only checks.", dependencies: ["format"] },
  default: {
    description: "Fix formatting, then run checks.",
    command: "deno fmt && deno task check",
  },
  all: { description: "Run all checks.", dependencies: ["check"] },
};

export const denoTaskNames = Object.keys(denoTaskDefinitions);

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
  for (const name of denoTaskNames) {
    const actual = tasks[name];
    if (actual === undefined) {
      missing.push(name);
    } else if (!isObject(actual)) {
      ambiguous.push(name);
    } else if (!sameJson(actual, denoTaskDefinitions[name])) {
      drifted.push(name);
    }
  }
  return { kind: "tasks", values: tasks, missing, drifted, ambiguous };
}

export function isObject(value: JsonValue): value is JsonObject {
  return value !== null && !Array.isArray(value) && typeof value === "object";
}

/** Returns the canonical standalone Deno configuration text. */
export function denoFmtConfigText(): string {
  return `${JSON.stringify({ tasks: denoTaskDefinitions }, null, 2)}\n`;
}
