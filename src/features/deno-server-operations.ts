/** @module Safety checks for the Deno server feature. */

import { legacyServerRegistry } from "./deno-server-legacy.ts";
import { inspectDenoServerTasks } from "./deno-server-tasks.ts";
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
  const tasks = inspectDenoServerTasks(
    config.kind === "config" ? config.value : {},
  );
  if (tasks.kind === "ambiguous") {
    return blocked("The Deno tasks entry is not an object.");
  }
  if (tasks.different.length && !repair(context)) {
    return blocked(
      `Server task ${
        tasks.different[0]
      } differs. Re-run with --repair to replace it.`,
    );
  }
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
  let cliReady = true;
  if (cliEnabled && !ownsCliChange(context)) {
    const integrated = await inspectDenoCliArtifacts(context, true);
    const base = await inspectDenoCliArtifacts(context, false);
    const adapter = integrated.find((item) =>
      item.schema.path === "src/cli/serve-command.ts"
    )!;
    if (adapter.result !== "matches" && adapter.result !== "absent") {
      return blocked(
        "The CLI serve adapter differs and cannot be replaced by server setup.",
      );
    }

    const registry = integrated.find((item) =>
      item.schema.path === "src/cli/commands.ts"
    )!;
    const baseRegistry = base.find((item) =>
      item.schema.path === "src/cli/commands.ts"
    )!;
    const launcher = integrated.find((item) =>
      item.schema.path === "src/cli/cli.ts"
    )!;
    const baseLauncher = base.find((item) =>
      item.schema.path === "src/cli/cli.ts"
    )!;
    if (launcher.result !== "matches" && baseLauncher.result !== "matches") {
      return blocked(
        "The CLI launcher differs and cannot be replaced by server setup.",
      );
    }
    cliReady = registry.result === "matches" && adapter.result === "matches" &&
      launcher.result === "matches";
    if (
      registry.result !== "matches" && baseRegistry.result !== "matches" &&
      !legacyServerRegistry(registry)
    ) {
      return blocked(
        "The CLI command registry differs and cannot be replaced by server setup.",
      );
    }
  }
  return cliReady && actual === denoServerExport &&
      tasks.missing.length === 0 &&
      tasks.different.length === 0 &&
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
  const tasks = inspectDenoServerTasks(config.value);
  if (tasks.kind === "ambiguous" || tasks.different.length) {
    return blocked("Custom server tasks cannot be removed.");
  }
  const cliEnabled = resolvedCliEnabled(
    context,
    config.value.exports["./cli"] === "./src/cli/cli.ts",
  );
  if (cliEnabled && !ownsCliChange(context)) {
    const integrated = await inspectDenoCliArtifacts(context, true);
    const base = await inspectDenoCliArtifacts(context, false);
    const launcher = integrated.find((item) =>
      item.schema.path === "src/cli/cli.ts"
    )!;
    const baseLauncher = base.find((item) =>
      item.schema.path === "src/cli/cli.ts"
    )!;
    if (launcher.result !== "matches" && baseLauncher.result !== "matches") {
      return blocked(
        "The CLI launcher differs and cannot be replaced by server setup.",
      );
    }
    const registry = integrated.find((
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
