/** @module Declarative additions to an initially created Deno configuration. */

import type { JsonObject, JsonValue } from "../api/json.ts";
import type { OperationContext } from "../api/repository-context.ts";
import { denoCliInitialConfigContribution } from "./deno-cli-artifacts.ts";
import { denoFmtFeatureId } from "./deno-fmt-inspection.ts";
import {
  denoTaskDefinitions,
  leafTaskDefinitions,
  leafTaskNames,
  taskFeatureIds,
} from "./deno-tasks.ts";
import { denoLibInitialConfigContribution } from "./deno-lib-artifacts.ts";
import { denoServerInitialConfigContribution } from "./deno-server-artifacts.ts";

const contributions = [
  denoCliInitialConfigContribution,
  denoLibInitialConfigContribution,
  denoServerInitialConfigContribution,
];

/** Adds declarations from features enabled in this ordered operation. */
export function initialDenoConfig(
  context: OperationContext,
  base: JsonObject,
  fallbackFeatureId?: string,
): JsonObject {
  const result = contributions.reduce(
    (value, contribution) =>
      context.resolvedChanges.some((change) =>
          change.featureId === contribution.featureId && change.enabled
        )
        ? mergeObjects(value, contribution.value)
        : fallbackFeatureId === contribution.featureId
        ? mergeObjects(value, contribution.value)
        : value,
    base,
  );
  const enabled = taskFeatureIds.filter((id) =>
    context.resolvedChanges.some((change) =>
      change.featureId === id && change.enabled
    )
  );
  return fallbackFeatureId === denoFmtFeatureId ||
      context.resolvedChanges.some((change) =>
        change.featureId === denoFmtFeatureId && change.enabled
      )
    ? mergeObjects(result, {
      tasks: {
        ...denoTaskDefinitions(enabled),
        ...Object.fromEntries(enabled.map((id) => [
          leafTaskNames[id],
          leafTaskDefinitions[id],
        ])),
      },
    })
    : result;
}

/** Selects one ordered feature to create an initially absent Deno config. */
export function createsInitialDenoConfig(
  context: OperationContext,
  featureId: string,
): boolean {
  return context.resolvedChanges.find((change) => change.enabled)?.featureId ===
      featureId || context.resolvedChanges.every((change) => !change.enabled);
}

function mergeObjects(left: JsonObject, right: JsonObject): JsonObject {
  const result: Record<string, JsonValue> = { ...left };
  for (const [key, value] of Object.entries(right)) {
    const existing = result[key];
    result[key] = isObject(existing) && isObject(value)
      ? mergeObjects(existing, value)
      : value;
  }
  return result;
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return value !== undefined && value !== null && !Array.isArray(value) &&
    typeof value === "object";
}
