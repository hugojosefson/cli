/** @module Ordered Deno server change plans. */

import type { ChangePlan } from "../api/change-plan.ts";
import type { AllowedOperation } from "../api/feature-operation.ts";
import type { PlannedChange } from "../api/planned-change.ts";
import type { OperationContext } from "../api/repository-context.ts";
import {
  denoCliExport,
  inspectDenoCliArtifacts,
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
  addServerRegistry,
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
    addServerRegistry(
      changes,
      await inspectDenoCliArtifacts(context, true),
      true,
    );
  }
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
  const changes: PlannedChange[] =
    config.kind === "config" && isObject(config.value.exports) &&
      config.value.exports["./server"] === denoServerExport
      ? [{
        kind: "remove-json",
        path: config.path,
        jsonPath: ["exports", "./server"],
        expected: denoServerExport,
      }]
      : [];
  const cliEnabled = resolvedCliEnabled(
    context,
    config.kind === "config" && isObject(config.value.exports) &&
      config.value.exports["./cli"] === denoCliExport,
  );
  if (cliEnabled && !ownsCliChange(context)) {
    addServerRegistry(
      changes,
      await inspectDenoCliArtifacts(context, false),
      false,
    );
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
