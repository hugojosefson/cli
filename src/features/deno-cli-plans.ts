/** @module Ordered Deno CLI change plans. */

import type { ChangePlan } from "../api/change-plan.ts";
import type { AllowedOperation } from "../api/feature-operation.ts";
import type { PlannedChange } from "../api/planned-change.ts";
import type { OperationContext } from "../api/repository-context.ts";
import {
  denoCliArtifacts,
  denoCliExport,
  denoCliFeatureId,
  inspectDenoCliArtifacts,
} from "./deno-cli-artifacts.ts";
import { inspectDenoConfig } from "./deno-config.ts";
import {
  createsInitialDenoConfig,
  initialDenoConfig,
} from "./deno-initial-config.ts";
import { isObject } from "./deno-tasks.ts";

export async function planEnableDenoCli(
  context: OperationContext,
  allowed: AllowedOperation,
): Promise<ChangePlan> {
  const config = await inspectDenoConfig(context);
  const artifacts = await inspectDenoCliArtifacts(context);
  const changes: PlannedChange[] = [];
  if (
    config.kind === "absent" &&
    createsInitialDenoConfig(context, denoCliFeatureId)
  ) {
    changes.push({
      kind: "write-file",
      path: "deno.jsonc",
      content: `${
        JSON.stringify(
          initialDenoConfig(context, {}, denoCliFeatureId),
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
      config.value.exports["./cli"] !== denoCliExport)
  ) {
    changes.push({
      kind: "set-json",
      path: config.path,
      jsonPath: ["exports", "./cli"],
      value: denoCliExport,
      expected: isObject(config.value.exports)
        ? config.value.exports["./cli"]
        : undefined,
    });
  }
  for (const path of ["src", "src/cli", "test"]) {
    if ((await context.files.observe(path)).kind === "absent") {
      changes.push({ kind: "create-directory", path });
    }
  }
  for (const [index, item] of artifacts.entries()) {
    if (item.result === "matches") continue;
    const file = item.result === "differs" && item.observation.kind === "file";
    if (
      item.result === "absent" ||
      file &&
        item.differences.some((difference) => difference.kind === "content")
    ) {
      changes.push({
        kind: "write-file",
        path: denoCliArtifacts[index].path,
        content: denoCliArtifacts[index].content,
        mode: denoCliArtifacts[index].mode,
        expectedDigest: file ? item.observation.digest : undefined,
      });
    }
    if (file && item.observation.mode !== denoCliArtifacts[index].mode) {
      changes.push({
        kind: "set-file-mode",
        path: denoCliArtifacts[index].path,
        mode: denoCliArtifacts[index].mode,
        expectedMode: item.observation.mode,
      });
    }
  }
  return plan(
    "enable",
    allowed,
    changes,
    "Configure Deno CLI export and executable seed.",
    "enabled",
  );
}

export async function planDisableDenoCli(
  context: OperationContext,
  allowed: AllowedOperation,
): Promise<ChangePlan> {
  const config = await inspectDenoConfig(context);
  const changes: PlannedChange[] =
    config.kind === "config" && isObject(config.value.exports) &&
      config.value.exports["./cli"] === denoCliExport
      ? [{
        kind: "remove-json",
        path: config.path,
        jsonPath: ["exports", "./cli"],
        expected: denoCliExport,
      }]
      : [];
  return plan(
    "disable",
    allowed,
    changes,
    "Remove the contributed Deno CLI export.",
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
    featureId: denoCliFeatureId,
    action,
    summary,
    warnings: allowed.warnings,
    preconditions: allowed.preconditions,
    changes,
    validations: [{
      kind: "feature-redetection",
      featureId: denoCliFeatureId,
      expected,
    }],
  };
}
