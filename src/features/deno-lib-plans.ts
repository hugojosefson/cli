/** @module Ordered Deno library change plans. */

import type { ChangePlan } from "../api/change-plan.ts";
import type { AllowedOperation } from "../api/feature-operation.ts";
import type { PlannedChange } from "../api/planned-change.ts";
import type { OperationContext } from "../api/repository-context.ts";
import { inspectDenoConfig } from "./deno-config.ts";
import {
  createsInitialDenoConfig,
  initialDenoConfig,
} from "./deno-initial-config.ts";
import {
  denoLibArtifacts,
  denoLibAssertImport,
  denoLibExport,
  denoLibFeatureId,
  inspectDenoLibArtifacts,
  isPreservedDenoLibTest,
  needsDenoLibAssert,
} from "./deno-lib-artifacts.ts";
import { isObject } from "./deno-tasks.ts";

export async function planEnableDenoLib(
  context: OperationContext,
  allowed: AllowedOperation,
): Promise<ChangePlan> {
  const config = await inspectDenoConfig(context);
  const artifacts = await inspectDenoLibArtifacts(context);
  const changes: PlannedChange[] = [];
  if (
    config.kind === "absent" &&
    createsInitialDenoConfig(context, denoLibFeatureId)
  ) {
    changes.push({
      kind: "write-file",
      path: "deno.jsonc",
      content: `${
        JSON.stringify(
          await initialDenoConfig(context, {}, denoLibFeatureId),
          null,
          2,
        )
      }\n`,
      mode: 0o644,
      expectedDigest: undefined,
    });
  } else if (
    config.kind === "config" &&
    (!isObject(config.value.exports) ||
      config.value.exports["."] !== denoLibExport)
  ) {
    changes.push({
      kind: "set-json",
      path: config.path,
      jsonPath: ["exports", "."],
      value: denoLibExport,
      expected: isObject(config.value.exports)
        ? config.value.exports["."]
        : undefined,
    });
  }
  if (
    config.kind === "config" && await needsDenoLibAssert(context) &&
    (!isObject(config.value.imports) ||
      config.value.imports["@std/assert"] === undefined)
  ) {
    changes.push({
      kind: "set-json",
      path: config.path,
      jsonPath: ["imports", "@std/assert"],
      value: denoLibAssertImport,
      expected: undefined,
    });
  }
  for (const path of ["src", "src/lib", "test"]) {
    if ((await context.files.observe(path)).kind === "absent") {
      changes.push({ kind: "create-directory", path });
    }
  }
  for (const [index, item] of artifacts.entries()) {
    if (item.result === "matches" || isPreservedDenoLibTest(item)) continue;
    const needsWrite = item.result === "absent" ||
      item.result === "differs" && item.observation.kind === "file" &&
        item.differences.some((difference) => difference.kind === "content");
    const expectedDigest =
      item.result === "differs" && item.observation.kind === "file"
        ? item.observation.digest
        : undefined;
    if (needsWrite) {
      changes.push({
        kind: "write-file",
        path: denoLibArtifacts[index].path,
        content: denoLibArtifacts[index].content,
        mode: 0o644,
        expectedDigest,
      });
    }
    if (
      item.result === "differs" && item.schema.kind === "file" &&
      item.observation.kind === "file" &&
      item.observation.mode !== item.schema.mode
    ) {
      changes.push({
        kind: "set-file-mode",
        path: denoLibArtifacts[index].path,
        mode: item.schema.mode,
        expectedMode: item.observation.mode,
      });
    }
  }
  return plan(
    "enable",
    allowed,
    changes,
    "Configure Deno library export and starter files.",
    "enabled",
  );
}

export async function planDisableDenoLib(
  context: OperationContext,
  allowed: AllowedOperation,
): Promise<ChangePlan> {
  const config = await inspectDenoConfig(context);
  const changes: PlannedChange[] =
    config.kind === "config" && isObject(config.value.exports) &&
      config.value.exports["."] === denoLibExport
      ? [{
        kind: "remove-json",
        path: config.path,
        jsonPath: ["exports", "."],
        expected: denoLibExport,
      }]
      : [];
  return plan(
    "disable",
    allowed,
    changes,
    "Remove the contributed Deno library export.",
    "disabled",
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
    featureId: denoLibFeatureId,
    action,
    summary,
    warnings: allowed.warnings,
    preconditions: allowed.preconditions,
    changes,
    validations: [{
      kind: "feature-redetection",
      featureId: denoLibFeatureId,
      expected,
    }],
  };
}
