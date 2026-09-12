/** @module Safety checks and ordered plans for the Deno library feature. */

import type { OperationCheck } from "../api/feature-operation.ts";
import type { OperationContext } from "../api/repository-context.ts";
import { inspectDenoConfig } from "./deno-config.ts";
import {
  denoLibExport,
  denoLibFeatureId,
  denoLibSubject,
  inspectDenoLibArtifacts,
  isPreservedDenoLibTest,
  needsDenoLibAssert,
} from "./deno-lib-artifacts.ts";
import { isObject } from "./deno-tasks.ts";

export async function checkEnableDenoLib(
  context: OperationContext,
): Promise<OperationCheck> {
  const config = await inspectDenoConfig(context);
  if (config.kind === "ambiguous") return blocked(config.observation);
  if (
    config.kind === "config" && config.value.exports !== undefined &&
    !isObject(config.value.exports)
  ) return blocked("The Deno exports entry is not an object.");
  if (
    config.kind === "config" && isObject(config.value.exports) &&
    config.value.exports["."] !== undefined &&
    config.value.exports["."] !== denoLibExport && !repair(context)
  ) {
    return blocked(
      "The library export differs. Re-run with --repair to replace it.",
    );
  }
  const needsAssert = await needsDenoLibAssert(context);
  if (
    needsAssert && config.kind === "config" &&
    config.value.imports !== undefined &&
    !isObject(config.value.imports)
  ) return blocked("The Deno imports entry is not an object.");
  if (
    needsAssert && config.kind === "config" && isObject(config.value.imports) &&
    config.value.imports["@std/assert"] !== undefined &&
    typeof config.value.imports["@std/assert"] !== "string"
  ) {
    return blocked("The @std/assert import must be a string.");
  }
  const artifacts = await inspectDenoLibArtifacts(context);
  for (const path of ["src", "src/lib", "test"]) {
    const entry = await context.files.observe(path);
    if (entry.kind !== "absent" && entry.kind !== "directory") {
      return blocked(`Starter parent ${path} is not a directory.`);
    }
  }
  const conflict = artifacts.find((item) =>
    item.result === "unreadable" ||
    (item.result === "differs" && item.observation.kind !== "file")
  );
  if (conflict) {
    return blocked(
      `Starter path ${conflict.schema.path} is not a regular file.`,
    );
  }
  if (
    artifacts.some((item) =>
      item.result === "differs" && !isPreservedDenoLibTest(item)
    ) && !repair(context)
  ) {
    return blocked(
      "Starter files differ. Re-run with --repair to replace them.",
    );
  }
  const adopted = config.kind === "config" && isObject(config.value.exports) &&
    config.value.exports["."] === denoLibExport &&
    artifacts.every((item) =>
      item.result === "matches" || isPreservedDenoLibTest(item)
    ) &&
    (!needsAssert ||
      isObject(config.value.imports) &&
        typeof config.value.imports["@std/assert"] === "string");
  return adopted
    ? {
      result: "no-op",
      reason: "Deno library is already adopted.",
      warnings: [],
    }
    : allowed();
}

export async function checkDisableDenoLib(
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
  if (config.value.exports["."] === undefined) return absent();
  return config.value.exports["."] === denoLibExport
    ? allowed()
    : blocked("The library export differs and cannot be removed.");
}

function allowed(): OperationCheck {
  return { result: "allowed", warnings: [], preconditions: [] };
}
function absent(): OperationCheck {
  return {
    result: "no-op",
    reason: "The Deno library export is absent.",
    warnings: [],
  };
}
function blocked(message: string): OperationCheck {
  return {
    result: "blocked",
    blockers: [{
      code: "deno-lib-conflict",
      message,
      subjects: [denoLibSubject()],
      resolution:
        "Resolve the conflict or use --repair for exact contributed content.",
    }],
    warnings: [],
  };
}
function repair(context: OperationContext): boolean {
  return context.repair?.kind === "all-drifted" ||
    context.repair?.kind === "features" &&
      context.repair.featureIds.includes(denoLibFeatureId);
}
