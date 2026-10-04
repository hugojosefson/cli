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
  needsDenoLibAssert,
} from "./deno-lib-artifacts.ts";
import { isObject } from "./deno-tasks.ts";

export async function planEnableDenoLib(
  context: OperationContext,
  allowed: AllowedOperation,
): Promise<ChangePlan> {
  const config = await inspectDenoConfig(context);
  const source = await context.files.observe("src/lib/mod.ts");
  const starter = source.kind === "absent" ||
    source.kind === "file" && source.content === denoLibArtifacts[0].content;
  const existingExport =
    config.kind === "config" && isObject(config.value.exports)
      ? config.value.exports["."]
      : undefined;
  if (existingExport !== undefined && existingExport !== denoLibExport) {
    return plan(
      "enable",
      allowed,
      [],
      "Preserve the configured library export.",
      "enabled",
    );
  }
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
  for (const path of starter ? ["src", "src/lib", "test"] : []) {
    if ((await context.files.observe(path)).kind === "absent") {
      changes.push({ kind: "create-directory", path });
    }
  }
  for (const artifact of starter ? denoLibArtifacts : []) {
    if ((await context.files.observe(artifact.path)).kind === "absent") {
      changes.push({
        kind: "write-file",
        path: artifact.path,
        content: artifact.content,
        mode: 0o644,
        expectedDigest: undefined,
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
      config.value.exports["."] !== undefined
      ? [{
        kind: "remove-json",
        path: config.path,
        jsonPath: ["exports", "."],
        expected: config.value.exports["."],
      }]
      : [];
  return plan(
    "disable",
    allowed,
    changes,
    "Remove the default library export. Preserve source and tests.",
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
