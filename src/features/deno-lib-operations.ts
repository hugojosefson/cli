/** @module Safety checks and ordered plans for the Deno library feature. */

import type { OperationCheck } from "../api/feature-operation.ts";
import type { OperationContext } from "../api/repository-context.ts";
import { localModulePath } from "./configured-deno-export.ts";
import {
  fileDifference,
  modulePathDifference,
} from "./detection-differences.ts";
import { inspectDenoConfig } from "./deno-config.ts";
import {
  denoLibArtifacts,
  denoLibExport,
  denoLibSubject,
  inspectDenoLibArtifacts,
  needsDenoLibAssert,
} from "./deno-lib-artifacts.ts";
import { configuredDenoLib, isDenoLibCliExport } from "./deno-lib-export.ts";
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
  const exports = config.kind === "config" && isObject(config.value.exports)
    ? config.value.exports
    : {};
  if (isDenoLibCliExport(exports)) {
    return blocked(
      "The default export belongs to the CLI. Preserve the CLI export.",
    );
  }
  const target = exports["."];
  if (target !== undefined && target !== denoLibExport) {
    if (await configuredDenoLib(context, exports)) {
      return adopted();
    }
    const path = localModulePath(target);
    if (path === undefined) {
      return blocked(
        modulePathDifference(
          config.kind === "config" ? config.path : "deno.jsonc",
          target,
          ".",
        ),
      );
    }
    const file = await context.files.observe(path);
    return blocked(
      file.kind === "file"
        ? `${path} is empty. Repair the library source manually.`
        : fileDifference(path, file),
    );
  }
  const source = await context.files.observe("src/lib/mod.ts");
  if (source.kind === "file" && source.content.trim().length === 0) {
    return blocked(
      "src/lib/mod.ts is empty. Repair the library source manually.",
    );
  }
  if (
    source.kind === "file" && source.content !== denoLibArtifacts[0].content
  ) {
    return target === denoLibExport ? adopted() : allowed();
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
  return target === denoLibExport &&
      artifacts.every((item) =>
        item.result === "matches" ||
        item.result === "differs" && item.observation.kind === "file"
      ) &&
      (!needsAssert ||
        config.kind === "config" && isObject(config.value.imports) &&
          typeof config.value.imports["@std/assert"] === "string")
    ? adopted()
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
  if (
    config.value.exports["."] === undefined ||
    isDenoLibCliExport(config.value.exports)
  ) {
    return absent();
  }
  return config.value.exports["."] === denoLibExport ||
      await configuredDenoLib(context, config.value.exports)
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
        "Correct the named configuration entry or file manually. Preserve library source and tests.",
    }],
    warnings: [],
  };
}
function adopted(): OperationCheck {
  return {
    result: "no-op",
    reason: "The library export is configured.",
    warnings: [],
  };
}
