/** @module Declarative additions to an initially created Deno configuration. */

import type { JsonObject, JsonValue } from "../api/json.ts";
import type { OperationContext } from "../api/repository-context.ts";
import { denoLibInitialConfigContribution } from "./deno-lib-artifacts.ts";

const contributions = [denoLibInitialConfigContribution];

/** Adds declarations from features enabled in this ordered operation. */
export function initialDenoConfig(
  context: OperationContext,
  base: JsonObject,
): JsonObject {
  return contributions.reduce(
    (value, contribution) =>
      context.resolvedChanges.some((change) =>
          change.featureId === contribution.featureId && change.enabled
        )
        ? mergeObjects(value, contribution.value)
        : value,
    base,
  );
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
