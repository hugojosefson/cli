/** @module Guarded JSR package change plans. */

import type { ChangePlan } from "../api/change-plan.ts";
import type { AllowedOperation } from "../api/feature-operation.ts";
import type { PlannedChange } from "../api/planned-change.ts";
import type { OperationContext } from "../api/repository-context.ts";
import { sameJson } from "../operations/local-plan-state.ts";
import { inspectDenoConfig } from "./deno-config.ts";
import {
  denoTaskDefinitions,
  desiredCheckDefinition,
  desiredReadmeBuild,
  desiredTaskIds,
  isObject,
} from "./deno-tasks.ts";
import {
  publishCheckDefinition,
  publishCheckName,
} from "./jsr-package-config.ts";
import { jsrPackageIdentity } from "./jsr-package-identity.ts";
import {
  checkDisableJsrPackage,
  checkEnableJsrPackage,
} from "./jsr-package-operations.ts";
import {
  jsrPlan,
  requireAllowed,
  setJsrConfig,
} from "./jsr-package-plan-support.ts";

export async function planEnableJsrPackage(
  context: OperationContext,
  allowed: AllowedOperation,
): Promise<ChangePlan> {
  await requireAllowed(checkEnableJsrPackage(context));
  const config = await inspectDenoConfig(context);
  if (config.kind === "absent") {
    return jsrPlan(
      "enable",
      allowed,
      [],
      "Configure JSR package metadata and publishing check.",
      "enabled",
    );
  }
  if (config.kind !== "config") {
    throw new Error("JSR package configuration changed after checking.");
  }
  const identity = await jsrPackageIdentity(context);
  if (identity.kind !== "available") {
    throw new Error("JSR package identity changed after checking.");
  }
  const changes: PlannedChange[] = [];
  if (config.value.name === undefined) {
    changes.push(setJsrConfig(config.path, ["name"], identity.name, undefined));
  }
  if (config.value.version === undefined) {
    changes.push(setJsrConfig(config.path, ["version"], "0.0.0", undefined));
  }
  if (config.value.tasks === undefined && enablesDenoFmt(context)) {
    return jsrPlan(
      "enable",
      allowed,
      changes,
      "Configure JSR package metadata and publishing check.",
      "enabled",
    );
  }
  const tasks = isObject(config.value.tasks) ? config.value.tasks : {};
  if (!sameJson(tasks[publishCheckName], publishCheckDefinition)) {
    changes.push(
      setJsrConfig(
        config.path,
        ["tasks", publishCheckName],
        publishCheckDefinition,
        tasks[publishCheckName],
      ),
    );
  }
  const check = desiredCheckDefinition(context, tasks);
  if (!sameJson(tasks.check, check)) {
    changes.push(
      setJsrConfig(config.path, ["tasks", "check"], check, tasks.check),
    );
  }
  return jsrPlan(
    "enable",
    allowed,
    changes,
    "Configure JSR package metadata and publishing check.",
    "enabled",
  );
}

export async function planDisableJsrPackage(
  context: OperationContext,
  allowed: AllowedOperation,
): Promise<ChangePlan> {
  await requireAllowed(checkDisableJsrPackage(context));
  const config = await inspectDenoConfig(context);
  if (config.kind !== "config" || !isObject(config.value.tasks)) {
    return jsrPlan(
      "disable",
      allowed,
      [],
      "Remove the owned JSR publishing check.",
      "disabled",
    );
  }
  const tasks = config.value.tasks;
  const changes: PlannedChange[] = [{
    kind: "remove-json",
    path: config.path,
    jsonPath: ["tasks", publishCheckName],
    expected: publishCheckDefinition,
  }, {
    kind: "set-json",
    path: config.path,
    jsonPath: ["tasks", "check"],
    value: denoTaskDefinitions(
      desiredTaskIds(context, tasks),
      desiredReadmeBuild(context, tasks),
      false,
    ).check!,
    expected: tasks.check,
  }];
  return jsrPlan(
    "disable",
    allowed,
    changes,
    "Remove the owned JSR publishing check.",
    "disabled",
  );
}

function enablesDenoFmt(context: OperationContext): boolean {
  return context.resolvedChanges.some((change) =>
    change.featureId === "deno-fmt" && change.enabled
  );
}
