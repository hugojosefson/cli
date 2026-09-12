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
import {
  denoLibInitialConfigContribution,
  needsDenoLibAssert,
} from "./deno-lib-artifacts.ts";
import { denoServerInitialConfigContribution } from "./deno-server-artifacts.ts";
import { denoTestTasks, hasServer } from "./deno-test-tasks.ts";
import { jsrPackageIdentity } from "./jsr-package-identity.ts";
import {
  publishCheckDefinition,
  publishCheckName,
} from "./jsr-package-config.ts";

const contributions = [
  denoCliInitialConfigContribution,
  denoLibInitialConfigContribution,
  denoServerInitialConfigContribution,
];

/** Adds declarations from features enabled in this ordered operation. */
export async function initialDenoConfig(
  context: OperationContext,
  base: JsonObject,
  fallbackFeatureId?: string,
): Promise<JsonObject> {
  const includeLibAssert = await needsDenoLibAssert(context);
  const result = contributions.map((contribution) =>
    contribution.featureId === "deno-lib" && !includeLibAssert
      ? {
        ...contribution,
        value: { exports: denoLibInitialConfigContribution.value.exports },
      }
      : contribution
  ).reduce(
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
  const configured = fallbackFeatureId === denoFmtFeatureId ||
      context.resolvedChanges.some((change) =>
        change.featureId === denoFmtFeatureId && change.enabled
      )
    ? mergeObjects(result, {
      tasks: {
        ...denoTaskDefinitions(
          enabled,
          context.resolvedChanges.some((change) =>
            change.featureId === "readme-build" && change.enabled
          ),
        ),
        ...(enabled.includes("deno-test")
          ? denoTestTasks(
            isObject(result.tasks) ? result.tasks : {},
            hasServer(result),
          )
          : {}),
        ...Object.fromEntries(enabled.map((id) => [
          leafTaskNames[id],
          leafTaskDefinitions[id],
        ])),
      },
    })
    : result;
  if (
    !context.resolvedChanges.some((change) =>
      change.featureId === "jsr-package" && change.enabled
    )
  ) return configured;
  const identity = await jsrPackageIdentity(context);
  if (identity.kind !== "available") return configured;
  const tasks = configured.tasks as JsonObject | undefined;
  const check = tasks?.check as JsonObject | undefined;
  return mergeObjects(configured, {
    name: identity.name,
    version: "0.0.0",
    tasks: {
      ...tasks,
      [publishCheckName]: publishCheckDefinition,
      check: {
        ...check,
        dependencies: [
          ...(check?.dependencies as JsonValue[] ?? []),
          publishCheckName,
        ],
      },
    },
  });
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
