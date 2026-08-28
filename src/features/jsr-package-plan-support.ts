/** @module Shared JSR package plan constructors. */

import type { ChangePlan } from "../api/change-plan.ts";
import type { AllowedOperation } from "../api/feature-operation.ts";
import type { JsonValue } from "../api/json.ts";
import type { PlannedChange } from "../api/planned-change.ts";
import { jsrPackageFeatureId } from "./jsr-package-config.ts";

export async function requireAllowed(check: Promise<unknown>): Promise<void> {
  const value = await check as { result: string };
  if (value.result === "blocked") {
    throw new Error("JSR package configuration changed after checking.");
  }
}

export function setJsrConfig(
  path: "deno.json" | "deno.jsonc",
  jsonPath: readonly string[],
  value: JsonValue,
  expected: JsonValue | undefined,
): PlannedChange {
  return { kind: "set-json", path, jsonPath, value, expected };
}

export function jsrPlan(
  action: "enable" | "disable",
  allowed: AllowedOperation,
  changes: readonly PlannedChange[],
  summary: string,
  expected: "enabled" | "disabled",
): ChangePlan {
  return {
    featureId: jsrPackageFeatureId,
    action,
    summary,
    warnings: allowed.warnings,
    preconditions: allowed.preconditions,
    changes,
    validations: [{
      kind: "feature-redetection",
      featureId: jsrPackageFeatureId,
      expected,
    }],
  };
}
