/** @module Read-only inspection of JSR package configuration. */

import { validJsrName } from "../package/metadata.ts";
import { localModulePath } from "./configured-deno-export.ts";
import { configuredDenoTask } from "./configured-deno-task.ts";
import type { DetectionContext } from "../api/repository-context.ts";
import type { JsonObject, JsonValue } from "../api/json.ts";
import { sameJson } from "../operations/local-plan-state.ts";
import { inspectDenoConfig } from "./deno-config.ts";
import { currentCheckDefinition, isObject } from "./deno-tasks.ts";
import {
  legacyPublishCheckDefinition,
  publishCheckDefinition,
  publishCheckName,
} from "./jsr-package-config.ts";
import { jsrPackageIdentity } from "./jsr-package-identity.ts";

const semver =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*)|(?:\d*[A-Za-z-][0-9A-Za-z-]*))(?:\.(?:(?:0|[1-9]\d*)|(?:\d*[A-Za-z-][0-9A-Za-z-]*)))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export type JsrPackageInspection =
  | { readonly state: "disabled"; readonly observation: string }
  | { readonly state: "ambiguous"; readonly observation: string }
  | {
    readonly state: "enabled";
    readonly observation: string;
    readonly config: JsonObject;
    readonly path: "deno.json" | "deno.jsonc";
  }
  | {
    readonly state: "drifted";
    readonly observation: string;
    readonly config: JsonObject;
    readonly path: "deno.json" | "deno.jsonc";
    readonly repairs: readonly string[];
    readonly missingExport: boolean;
  };

/** Inspects identity, exports, the publish task, and the exact check aggregate. */
export async function inspectJsrPackage(
  context: DetectionContext,
  ownedOnly = false,
): Promise<JsrPackageInspection> {
  const config = await inspectDenoConfig(context);
  if (config.kind === "absent") {
    return simple("disabled", "Deno configuration is absent.");
  }
  if (config.kind === "ambiguous") {
    return simple("ambiguous", config.observation);
  }
  const tasks = config.value.tasks;
  if (tasks !== undefined && !isObject(tasks)) {
    return simple("ambiguous", "The Deno tasks entry is not an object.");
  }
  if (
    (!tasks || tasks[publishCheckName] === undefined) &&
    config.value.name === undefined && config.value.version === undefined
  ) {
    return simple("disabled", "The publish-check task is absent.");
  }
  if (
    config.value.name !== undefined &&
    (typeof config.value.name !== "string" ||
      !validJsrName(config.value.name))
  ) {
    return simple(
      "ambiguous",
      "The package name is not a valid scoped JSR name.",
    );
  }
  const identity = await jsrPackageIdentity(context);
  if (identity.kind === "unavailable") {
    return simple("ambiguous", identity.observation);
  }
  if (
    config.value.version !== undefined &&
    (typeof config.value.version !== "string" ||
      !semver.test(config.value.version))
  ) return simple("ambiguous", "The package version is not exact SemVer.");
  if (!tasks || tasks[publishCheckName] === undefined) {
    return simple("disabled", "The publish-check task is absent.");
  }
  const repairs: string[] = [];
  const configuredTask = ownedOnly
    ? sameJson(tasks[publishCheckName], publishCheckDefinition)
    : await configuredDenoTask(context, tasks, publishCheckName, "publish");
  if (
    !configuredTask ||
    sameJson(tasks[publishCheckName], legacyPublishCheckDefinition)
  ) {
    repairs.push("publish-check task");
  }
  if (ownedOnly && !sameJson(tasks.check, currentCheckDefinition(tasks))) {
    repairs.push("check aggregate");
  }
  const missingExport = !validExport(config.value.exports);
  if (missingExport) repairs.push("Deno export");
  if (
    repairs.length > 0 || config.value.name === undefined ||
    config.value.version === undefined
  ) {
    const observation = repairs[0] === "publish-check task"
      ? "The publish-check task differs."
      : repairs[0] === "check aggregate"
      ? "The check aggregate differs."
      : missingExport
      ? "A Deno export is missing or invalid."
      : config.value.name === undefined
      ? "The package name is missing."
      : "The package version is missing.";
    return {
      state: "drifted",
      observation,
      config: config.value,
      path: config.path,
      repairs,
      missingExport,
    };
  }
  return {
    state: "enabled",
    observation: ownedOnly
      ? "JSR package metadata and publish check are adopted."
      : "Local JSR metadata and a publishing check are configured.",
    config: config.value,
    path: config.path,
  };
}

function simple(
  state: "disabled" | "ambiguous",
  observation: string,
): JsrPackageInspection {
  return { state, observation };
}

function validExport(value: JsonValue | undefined): boolean {
  if (typeof value === "string") return localModulePath(value) !== undefined;
  return value !== undefined && isObject(value) &&
    Object.keys(value).length > 0 &&
    Object.entries(value).every(([name, target]) =>
      (name === "." || localModulePath(name) !== undefined) &&
      localModulePath(target) !== undefined
    );
}
