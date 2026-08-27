/** @module Safety checks for the Deno server feature. */

import type { OperationCheck } from "../api/feature-operation.ts";
import type { OperationContext } from "../api/repository-context.ts";
import { inspectDenoCliArtifacts } from "./deno-cli-artifacts.ts";
import { inspectDenoConfig } from "./deno-config.ts";
import { isObject } from "./deno-tasks.ts";
import {
  denoServerExport,
  denoServerFeatureId,
  denoServerSubject,
  inspectDenoServerArtifacts,
} from "./deno-server-artifacts.ts";
import { resolvedCliEnabled } from "./deno-server-state.ts";

export async function checkEnableDenoServer(
  context: OperationContext,
): Promise<OperationCheck> {
  const config = await inspectDenoConfig(context);
  if (config.kind === "ambiguous") return blocked(config.observation);
  if (
    config.kind === "config" && config.value.exports !== undefined &&
    !isObject(config.value.exports)
  ) return blocked("The Deno exports entry is not an object.");
  const actual = config.kind === "config" && isObject(config.value.exports)
    ? config.value.exports["./server"]
    : undefined;
  if (actual !== undefined && actual !== denoServerExport && !repair(context)) {
    return blocked(
      "The server export differs. Re-run with --repair to replace it.",
    );
  }
  for (const path of ["src", "src/server", "test"]) {
    const entry = await context.files.observe(path);
    if (entry.kind !== "absent" && entry.kind !== "directory") {
      return blocked(`Starter parent ${path} is not a directory.`);
    }
  }
  const artifacts = await inspectDenoServerArtifacts(context);
  const conflict = artifacts.find((item) =>
    item.result === "unreadable" ||
    item.result === "differs" && item.observation.kind !== "file"
  );
  if (conflict) {
    return blocked(
      `Starter path ${conflict.schema.path} is not a regular file.`,
    );
  }
  if (artifacts.some((item) => item.result === "differs") && !repair(context)) {
    return blocked(
      "Starter files differ. Re-run with --repair to replace them.",
    );
  }
  const cliEnabled = resolvedCliEnabled(
    context,
    config.kind === "config" && isObject(config.value.exports) &&
      config.value.exports["./cli"] === "./src/cli/cli.ts",
  );
  if (cliEnabled && !ownsCliChange(context)) {
    const integrated = await inspectDenoCliArtifacts(context, true);
    const base = await inspectDenoCliArtifacts(context, false);
    const registry = integrated.find((item) =>
      item.schema.path === "src/cli/commands.ts"
    )!;
    const baseRegistry = base.find((item) =>
      item.schema.path === "src/cli/commands.ts"
    )!;
    if (registry.result !== "matches" && baseRegistry.result !== "matches") {
      return blocked(
        "The CLI command registry differs and cannot be replaced by server setup.",
      );
    }
  }
  return actual === denoServerExport &&
      artifacts.every((item) => item.result === "matches")
    ? {
      result: "no-op",
      reason: "Deno server is already adopted.",
      warnings: [],
    }
    : allowed();
}

export async function checkDisableDenoServer(
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
  if (config.value.exports["./server"] === undefined) return absent();
  if (config.value.exports["./server"] !== denoServerExport) {
    return blocked("The server export differs and cannot be removed.");
  }
  const cliEnabled = resolvedCliEnabled(
    context,
    config.value.exports["./cli"] === "./src/cli/cli.ts",
  );
  if (cliEnabled && !ownsCliChange(context)) {
    const registry = (await inspectDenoCliArtifacts(context, true)).find((
      item,
    ) => item.schema.path === "src/cli/commands.ts")!;
    if (registry.result !== "matches") {
      return blocked(
        "The CLI command registry differs and cannot be replaced by server setup.",
      );
    }
  }
  return allowed();
}

function allowed(): OperationCheck {
  return { result: "allowed", warnings: [], preconditions: [] };
}
function absent(): OperationCheck {
  return {
    result: "no-op",
    reason: "The Deno server export is absent.",
    warnings: [],
  };
}
function blocked(message: string): OperationCheck {
  return {
    result: "blocked",
    blockers: [{
      code: "deno-server-conflict",
      message,
      subjects: [denoServerSubject()],
      resolution:
        "Resolve the conflict or use --repair for exact contributed content.",
    }],
    warnings: [],
  };
}
function repair(context: OperationContext): boolean {
  return context.repair?.kind === "all-drifted" ||
    context.repair?.kind === "features" &&
      context.repair.featureIds.includes(denoServerFeatureId);
}

function ownsCliChange(context: OperationContext): boolean {
  return context.resolvedChanges.some((change) =>
    change.featureId === "deno-cli"
  );
}
