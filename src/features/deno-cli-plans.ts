/** @module Ordered Deno CLI change plans. */

import {
  matchesFileAccess,
  repairFileMode,
} from "../repository/file-access.ts";
import { sameJson } from "../operations/local-plan-state.ts";
import type { ChangePlan } from "../api/change-plan.ts";
import type { AllowedOperation } from "../api/feature-operation.ts";
import type { PlannedChange } from "../api/planned-change.ts";
import type { OperationContext } from "../api/repository-context.ts";
import {
  denoCliExport,
  denoCliFeatureId,
  inspectDenoCliArtifacts,
  packageMetadataTask,
} from "./deno-cli-artifacts.ts";
import { inspectDenoConfig } from "./deno-config.ts";
import {
  createsInitialDenoConfig,
  initialDenoConfig,
} from "./deno-initial-config.ts";
import { isObject } from "./deno-tasks.ts";
import { denoServerExport } from "./deno-server-artifacts.ts";
import { resolvedServerEnabled } from "./deno-server-state.ts";

export async function planEnableDenoCli(
  context: OperationContext,
  allowed: AllowedOperation,
): Promise<ChangePlan> {
  const config = await inspectDenoConfig(context);
  const currentServer = config.kind === "config" &&
    isObject(config.value.exports) &&
    config.value.exports["./server"] === denoServerExport;
  const artifacts = await inspectDenoCliArtifacts(
    context,
    resolvedServerEnabled(context, currentServer),
  );
  const desiredArtifacts = artifacts.map((item) => {
    if (item.schema.kind !== "file") {
      throw new Error("Expected CLI file artifact.");
    }
    return item.schema;
  });
  const metadata = JSON.parse(
    desiredArtifacts.find((item) =>
      item.path === "src/cli/package-metadata.json"
    )!.content,
  ) as { name: string };
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
          await initialDenoConfig(context, {}, denoCliFeatureId),
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
  if (config.kind === "config") {
    const tasks = isObject(config.value.tasks) ? config.value.tasks : {};
    const formatterCreatesTasks = config.value.tasks === undefined &&
      context.resolvedChanges.some((change) =>
        change.featureId === "deno-fmt" && change.enabled
      );
    if (!formatterCreatesTasks && tasks["package-metadata"] === undefined) {
      changes.push({
        kind: "set-json",
        path: config.path,
        jsonPath: ["tasks", "package-metadata"],
        value: packageMetadataTask,
        expected: undefined,
      });
    }
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
        path: desiredArtifacts[index].path,
        content: desiredArtifacts[index].content,
        mode: desiredArtifacts[index].mode,
        expectedDigest: file ? item.observation.digest : undefined,
      });
    }
    if (
      file && !matchesFileAccess(item.observation, desiredArtifacts[index].mode)
    ) {
      changes.push({
        kind: "set-file-mode",
        path: desiredArtifacts[index].path,
        mode: repairFileMode(item.observation, desiredArtifacts[index].mode),
        expectedMode: item.observation.mode,
      });
    }
  }
  return plan(
    "enable",
    allowed,
    changes,
    `Configure Deno CLI export and executable seed for ${metadata.name}.`,
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
  if (
    config.kind === "config" && isObject(config.value.tasks) &&
    sameJson(config.value.tasks["package-metadata"], packageMetadataTask)
  ) {
    changes.push({
      kind: "remove-json",
      path: config.path,
      jsonPath: ["tasks", "package-metadata"],
      expected: packageMetadataTask,
    });
  }
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
