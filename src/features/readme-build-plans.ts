/** @module Guarded generated README change plans. */

import type { ChangePlan } from "../api/change-plan.ts";
import type { AllowedOperation } from "../api/feature-operation.ts";
import type { PlannedChange } from "../api/planned-change.ts";
import type { OperationContext } from "../api/repository-context.ts";
import { denoTaskDefinitions, readmeTaskDefinition } from "./deno-tasks.ts";
import {
  inspectReadmeBuild,
  readmeBuildDirectoryPath,
  readmeBuildFeatureId,
  readmeBuildRootPath,
  readmeBuildSourcePath,
} from "./readme-build-state.ts";

export async function planEnableReadmeBuild(
  context: OperationContext,
  allowed: AllowedOperation,
): Promise<ChangePlan> {
  const state = await inspectReadmeBuild(context);
  const changes: PlannedChange[] = [];
  if (state.source.kind === "absent") {
    changes.push({ kind: "create-directory", path: readmeBuildDirectoryPath }, {
      kind: "write-file",
      path: readmeBuildSourcePath,
      content: state.initialSource,
      mode: 0o644,
      expectedDigest: undefined,
    });
  }
  if (state.configPath && !denoFmtChanges(context)) {
    if (!state.exactTask) {
      changes.push({
        kind: "set-json",
        path: state.configPath,
        jsonPath: ["tasks", "readme"],
        value: readmeTaskDefinition,
        expected: state.taskValue,
      });
    }
    if (!state.exactDefault) {
      changes.push({
        kind: "set-json",
        path: state.configPath,
        jsonPath: ["tasks", "default"],
        value: denoTaskDefinitions(state.taskIds, true).default!,
        expected: state.defaultValue,
      });
    }
  }
  changes.push(...rootEnableChanges(state));
  return plan(
    "enable",
    allowed,
    changes,
    "Configure generated README output.",
    "enabled",
  );
}

export async function planDisableReadmeBuild(
  context: OperationContext,
  allowed: AllowedOperation,
): Promise<ChangePlan> {
  const state = await inspectReadmeBuild(context);
  if (state.directory.kind !== "directory" || !state.configPath) {
    throw new Error("Generated README state changed during planning.");
  }
  const changes: PlannedChange[] = [{
    kind: "set-file-mode",
    path: readmeBuildRootPath,
    mode: 0o644,
    expectedMode: 0o444,
  }];
  if (!denoFmtChanges(context)) {
    changes.push({
      kind: "set-json",
      path: state.configPath,
      jsonPath: ["tasks", "default"],
      value: denoTaskDefinitions(state.taskIds).default!,
      expected: state.defaultValue,
    }, {
      kind: "remove-json",
      path: state.configPath,
      jsonPath: ["tasks", "readme"],
      expected: readmeTaskDefinition,
    });
  }
  changes.push({
    kind: "remove-directory",
    path: readmeBuildDirectoryPath,
    expectedStateDigest: state.directory.stateDigest,
  });
  return plan(
    "disable",
    allowed,
    changes,
    "Preserve generated README.md as writable static content and remove readme/.",
    "disabled",
  );
}

function rootEnableChanges(
  state: Awaited<ReturnType<typeof inspectReadmeBuild>>,
): PlannedChange[] {
  if (state.root.kind === "absent") {
    return [{
      kind: "write-file",
      path: readmeBuildRootPath,
      content: state.output!,
      mode: 0o444,
      expectedDigest: undefined,
    }];
  }
  if (state.root.kind !== "file") {
    return [];
  }
  const changes: PlannedChange[] = [];
  const unlock = !state.rootMatches && (state.root.mode & 0o200) === 0;
  if (unlock) {
    changes.push({
      kind: "set-file-mode",
      path: readmeBuildRootPath,
      mode: 0o644,
      expectedMode: state.root.mode,
    });
  }
  if (!state.rootMatches) {
    changes.push({
      kind: "write-file",
      path: readmeBuildRootPath,
      content: state.output!,
      expectedDigest: state.root.digest,
    });
  }
  if (unlock || state.root.mode !== 0o444) {
    changes.push({
      kind: "set-file-mode",
      path: readmeBuildRootPath,
      mode: 0o444,
      expectedMode: unlock ? 0o644 : state.root.mode,
    });
  }
  return changes;
}

function denoFmtChanges(context: OperationContext): boolean {
  return context.resolvedChanges.some((change) =>
    change.featureId === "deno-fmt"
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
    featureId: readmeBuildFeatureId,
    action,
    summary,
    warnings: allowed.warnings,
    preconditions: allowed.preconditions,
    changes,
    validations: [{
      kind: "feature-redetection",
      featureId: readmeBuildFeatureId,
      expected,
    }],
  };
}
