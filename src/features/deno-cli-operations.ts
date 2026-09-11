/** @module Safety checks for the Deno CLI feature. */

import { configuredDenoCli } from "./configured-deno-export.ts";
import type { OperationCheck } from "../api/feature-operation.ts";
import type { OperationContext } from "../api/repository-context.ts";
import {
  denoCliExport,
  denoCliFeatureId,
  denoCliSubject,
  inspectDenoCliArtifacts,
} from "./deno-cli-artifacts.ts";
import { inspectDenoConfig } from "./deno-config.ts";
import { denoServerExport } from "./deno-server-artifacts.ts";
import { resolvedServerEnabled } from "./deno-server-state.ts";
import { isObject } from "./deno-tasks.ts";

export async function checkEnableDenoCli(
  context: OperationContext,
): Promise<OperationCheck> {
  const config = await inspectDenoConfig(context);
  if (config.kind === "ambiguous") return blocked(config.observation);
  if (
    config.kind === "config" && config.value.exports !== undefined &&
    !isObject(config.value.exports)
  ) {
    return blocked("The Deno exports entry is not an object.");
  }
  const actual = config.kind === "config" && isObject(config.value.exports)
    ? config.value.exports["./cli"]
    : undefined;
  if (
    !repair(context) && config.kind === "config" &&
    !context.resolvedChanges.some((change) =>
      change.featureId === "deno-server"
    ) &&
    await configuredDenoCli(context, config.value.exports)
  ) {
    return {
      result: "no-op",
      reason: "The CLI entry point is already configured.",
      warnings: [],
    };
  }
  if (actual !== undefined && actual !== denoCliExport && !repair(context)) {
    return blocked(
      "The CLI export differs. Re-run with --repair to replace it.",
    );
  }
  for (const path of ["src", "src/cli", "test"]) {
    const entry = await context.files.observe(path);
    if (entry.kind !== "absent" && entry.kind !== "directory") {
      return blocked(`Starter parent ${path} is not a directory.`);
    }
  }
  const currentServer = config.kind === "config" &&
    isObject(config.value.exports) &&
    config.value.exports["./server"] === denoServerExport;
  const serverEnabled = resolvedServerEnabled(context, currentServer);
  const artifacts = await inspectDenoCliArtifacts(context, serverEnabled);
  const alternateArtifacts = await inspectDenoCliArtifacts(
    context,
    !serverEnabled,
  );
  const conflict = artifacts.find((item) =>
    item.result === "unreadable" ||
    item.result === "differs" && item.observation.kind !== "file"
  );
  if (conflict) {
    return blocked(
      `Starter path ${conflict.schema.path} is not a regular file.`,
    );
  }
  const onlyServerTransition = artifacts.filter((item) =>
    item.result === "differs"
  ).every((item) =>
    alternateArtifacts.some((alternate) =>
      alternate.schema.path === item.schema.path &&
      alternate.result === "matches"
    )
  );
  if (
    artifacts.some((item) => item.result === "differs") && !repair(context) &&
    !onlyServerTransition
  ) {
    return blocked(
      "Executable seed differs. Re-run with --repair to replace it.",
    );
  }
  return actual === denoCliExport &&
      artifacts.every((item) => item.result === "matches")
    ? { result: "no-op", reason: "Deno CLI is already adopted.", warnings: [] }
    : { result: "allowed", warnings: [], preconditions: [] };
}

export async function checkDisableDenoCli(
  context: OperationContext,
): Promise<OperationCheck> {
  const config = await inspectDenoConfig(context);
  if (config.kind === "absent") return absent();
  if (config.kind === "ambiguous") return blocked(config.observation);
  if (!isObject(config.value.exports)) {
    return config.value.exports === undefined
      ? absent()
      : blocked("The Deno exports entry is not an object.");
  }
  if (config.value.exports["./cli"] === undefined) return absent();
  return config.value.exports["./cli"] === denoCliExport
    ? { result: "allowed", warnings: [], preconditions: [] }
    : blocked("The CLI export differs and cannot be removed.");
}

function absent(): OperationCheck {
  return {
    result: "no-op",
    reason: "The Deno CLI export is absent.",
    warnings: [],
  };
}
function blocked(message: string): OperationCheck {
  return {
    result: "blocked",
    blockers: [{
      code: "deno-cli-conflict",
      message,
      subjects: [denoCliSubject()],
      resolution:
        "Resolve the conflict or use --repair for exact contributed content.",
    }],
    warnings: [],
  };
}
function repair(context: OperationContext): boolean {
  return context.repair?.kind === "all-drifted" ||
    context.repair?.kind === "features" &&
      context.repair.featureIds.includes(denoCliFeatureId);
}
