/** @module Ordered Deno server change plans. */

import { planTestTasks } from "./deno-test-tasks.ts";
import { removeLegacyServerAdapter } from "./deno-server-legacy.ts";
import { denoServerTasks } from "./deno-server-tasks.ts";
import { sameJson } from "../operations/local-plan-state.ts";
import type { ChangePlan } from "../api/change-plan.ts";
import type { AllowedOperation } from "../api/feature-operation.ts";
import type { PlannedChange } from "../api/planned-change.ts";
import type { OperationContext } from "../api/repository-context.ts";
import {
  denoCliExport,
  inspectDenoCliArtifacts,
  packageMetadataTask,
} from "./deno-cli-artifacts.ts";
import { inspectDenoConfig } from "./deno-config.ts";
import {
  createsInitialDenoConfig,
  initialDenoConfig,
} from "./deno-initial-config.ts";
import {
  denoServerExport,
  denoServerFeatureId,
  inspectDenoServerArtifacts,
} from "./deno-server-artifacts.ts";
import {
  addServerArtifacts,
  addServerCliArtifacts,
} from "./deno-server-plan-artifacts.ts";
import { resolvedCliEnabled } from "./deno-server-state.ts";
import { isObject } from "./deno-tasks.ts";

export async function planEnableDenoServer(
  context: OperationContext,
  allowed: AllowedOperation,
): Promise<ChangePlan> {
  const config = await inspectDenoConfig(context);
  const artifacts = await inspectDenoServerArtifacts(context);
  const changes: PlannedChange[] = [];
  if (
    config.kind === "absent" &&
    createsInitialDenoConfig(context, denoServerFeatureId)
  ) {
    changes.push({
      kind: "write-file",
      path: "deno.jsonc",
      content: `${
        JSON.stringify(
          await initialDenoConfig(context, {}, denoServerFeatureId),
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
      config.value.exports["./server"] !== denoServerExport)
  ) {
    changes.push({
      kind: "set-json",
      path: config.path,
      jsonPath: ["exports", "./server"],
      value: denoServerExport,
      expected: isObject(config.value.exports)
        ? config.value.exports["./server"]
        : undefined,
    });
  }
  if (config.kind === "config") {
    const tasks = config.value.tasks;
    const formatterCreatesTasks = tasks === undefined &&
      context.resolvedChanges.some((change) =>
        change.featureId === "deno-fmt" && change.enabled
      );
    if (tasks === undefined && !formatterCreatesTasks) {
      changes.push({
        kind: "set-json",
        path: config.path,
        jsonPath: ["tasks"],
        value: denoServerTasks,
        expected: undefined,
      });
    } else if (isObject(tasks)) {
      for (const [name, definition] of Object.entries(denoServerTasks)) {
        if (!sameJson(tasks[name], definition)) {
          changes.push({
            kind: "set-json",
            path: config.path,
            jsonPath: ["tasks", name],
            value: definition,
            expected: tasks[name],
          });
        }
      }
    }
  }
  if (config.kind === "config") {
    changes.push(
      ...planTestTasks(context, config.value, config.path, "deno-server", true),
    );
  }
  for (const path of ["src", "src/server", "test"]) {
    if ((await context.files.observe(path)).kind === "absent") {
      changes.push({ kind: "create-directory", path });
    }
  }
  addServerArtifacts(changes, artifacts);
  const cliEnabled = resolvedCliEnabled(
    context,
    config.kind === "config" && isObject(config.value.exports) &&
      config.value.exports["./cli"] === denoCliExport,
  );
  if (cliEnabled && !ownsCliChange(context)) {
    if (
      config.kind === "config" &&
      (config.value.tasks === undefined || isObject(config.value.tasks) &&
          config.value.tasks["package-metadata"] === undefined)
    ) {
      changes.push({
        kind: "set-json",
        path: config.path,
        jsonPath: ["tasks", "package-metadata"],
        value: packageMetadataTask,
        expected: undefined,
      });
    }
    addServerCliArtifacts(
      changes,
      await inspectDenoCliArtifacts(context, true),
    );
  }
  changes.push(...await removeLegacyServerAdapter(context));
  return plan(
    "enable",
    allowed,
    changes,
    "Configure Deno server export and starter files.",
    "enabled",
  );
}

export async function planDisableDenoServer(
  context: OperationContext,
  allowed: AllowedOperation,
): Promise<ChangePlan> {
  const config = await inspectDenoConfig(context);
  const changes: PlannedChange[] = [];
  if (config.kind === "config" && isObject(config.value.tasks)) {
    for (const [name, definition] of Object.entries(denoServerTasks)) {
      if (sameJson(config.value.tasks[name], definition)) {
        changes.push({
          kind: "remove-json",
          path: config.path,
          jsonPath: ["tasks", name],
          expected: definition,
        });
      }
    }
  }
  const cliEnabled = resolvedCliEnabled(
    context,
    config.kind === "config" && isObject(config.value.exports) &&
      config.value.exports["./cli"] === denoCliExport,
  );
  if (cliEnabled && !ownsCliChange(context)) {
    if (
      config.kind === "config" &&
      (config.value.tasks === undefined || isObject(config.value.tasks) &&
          config.value.tasks["package-metadata"] === undefined)
    ) {
      changes.push({
        kind: "set-json",
        path: config.path,
        jsonPath: ["tasks", "package-metadata"],
        value: packageMetadataTask,
        expected: undefined,
      });
    }
    addServerCliArtifacts(
      changes,
      await inspectDenoCliArtifacts(context, false),
    );
  }
  if (config.kind === "config") {
    changes.push(
      ...planTestTasks(
        context,
        config.value,
        config.path,
        "deno-server",
        false,
      ),
    );
  }
  // Keep the feature visible until task and registry cleanup succeeds.
  if (
    config.kind === "config" && isObject(config.value.exports) &&
    config.value.exports["./server"] === denoServerExport
  ) {
    changes.push({
      kind: "remove-json",
      path: config.path,
      jsonPath: ["exports", "./server"],
      expected: denoServerExport,
    });
  }
  return plan(
    "disable",
    allowed,
    changes,
    "Remove the contributed Deno server export.",
    "disabled",
  );
}

function ownsCliChange(context: OperationContext): boolean {
  return context.resolvedChanges.some((change) =>
    change.featureId === "deno-cli"
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
    featureId: denoServerFeatureId,
    action,
    summary,
    warnings: allowed.warnings,
    preconditions: allowed.preconditions,
    changes,
    validations: [{
      kind: "feature-redetection",
      featureId: denoServerFeatureId,
      expected,
    }],
  };
}
