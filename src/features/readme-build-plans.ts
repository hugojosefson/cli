/** @module Guarded generated README change plans. */

import { fileAccess, repairFileMode } from "../repository/file-access.ts";
import { legacyReadmePreview } from "./readme-build-checks.ts";
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
import { selectedLicenseLabel } from "./license-readme-label.ts";
import { licenseCatalog } from "./license-catalog.ts";
import {
  appendLicenseSection,
  exactLicenseSection,
  inspectLicenseSection,
  replaceLicenseSection,
} from "../readme/license-section.ts";
import { buildReadmeText } from "../readme/build-readme.ts";

export async function planEnableReadmeBuild(
  context: OperationContext,
  allowed: AllowedOperation,
): Promise<ChangePlan> {
  const state = await inspectReadmeBuild(context);
  const changes: PlannedChange[] = [];
  if (state.source.kind === "file" && !fileAccess(state.source).writable) {
    changes.push({
      kind: "set-file-mode",
      path: readmeBuildSourcePath,
      mode: repairFileMode(state.source, 0o644),
      expectedMode: state.source.mode,
    });
  }
  const initialSource = state.source.kind === "file"
    ? state.source.content
    : state.initialSource;
  const sourceContent = buildSourceContent(
    context,
    state.legacy.kind === "recognized" ? state.legacy.source : initialSource,
  );
  if (state.source.kind === "absent") {
    changes.push({ kind: "create-directory", path: readmeBuildDirectoryPath }, {
      kind: "write-file",
      path: readmeBuildSourcePath,
      content: sourceContent,
      mode: 0o644,
      expectedDigest: undefined,
    });
  } else if (state.source.kind === "file" && sourceContent !== initialSource) {
    changes.push({
      kind: "write-file",
      path: readmeBuildSourcePath,
      content: sourceContent,
      mode: 0o644,
      expectedDigest: state.source.digest,
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
  if (sourceContent !== initialSource || state.source.kind === "absent") {
    const output = await buildReadmeText(context.repositoryRoot, sourceContent);
    changes.push(...rootEnableChanges({
      ...state,
      output,
      rootMatches: state.root.kind === "file" && state.root.content === output,
    }));
  } else changes.push(...rootEnableChanges(state));
  const migration = state.legacy.kind === "recognized";
  if (migration && !await context.files.exists(".hj/readme.json")) {
    changes.push({ kind: "create-directory", path: ".hj" }, {
      kind: "write-file",
      path: ".hj/readme.json",
      content: JSON.stringify({ version: 1, files: {} }, null, 2) + "\n",
      mode: 0o644,
      expectedDigest: undefined,
    });
  }
  return plan(
    "enable",
    migration && state.directory.kind === "directory"
      ? {
        ...allowed,
        preconditions: [...allowed.preconditions, {
          kind: "directory-state",
          path: readmeBuildDirectoryPath,
          digest: state.directory.stateDigest,
        }],
      }
      : allowed,
    changes,
    migration
      ? legacyReadmePreview(state)
      : "Configure generated README output.",
    "enabled",
  );
}

function buildSourceContent(
  context: OperationContext,
  initial: string,
): string {
  const label = selectedLicenseLabel(context);
  const labels = licenseCatalog.map((provider) => provider.definition.name);
  if (label) {
    const alternates = labels.filter((item) => item !== label);
    const source = inspectLicenseSection(
      initial,
      label,
      "../LICENSE",
      alternates,
    );
    if (source.kind === "exact") return initial;
    if (source.kind === "alternate") {
      return replaceLicenseSection(
        initial,
        source.section,
        exactLicenseSection(label, "../LICENSE"),
      );
    }
    const root = inspectLicenseSection(initial, label, "./LICENSE", alternates);
    if (root.kind === "exact" || root.kind === "alternate") {
      return replaceLicenseSection(
        initial,
        root.section,
        exactLicenseSection(label, "../LICENSE"),
      );
    }
    return source.kind === "missing"
      ? appendLicenseSection(
        initial,
        exactLicenseSection(label, "../LICENSE"),
      )
      : initial;
  }
  for (const known of labels) {
    const section = inspectLicenseSection(initial, known, "./LICENSE", []);
    if (section.kind === "exact") {
      return replaceLicenseSection(
        initial,
        section.section,
        exactLicenseSection(known, "../LICENSE"),
      );
    }
  }
  return initial;
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
    mode: state.root.kind === "file"
      ? repairFileMode(state.root, 0o644)
      : 0o644,
    expectedMode: state.rootMode,
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
      expected: state.taskValue!,
    });
  }
  if (await context.files.exists(".hj/readme.json")) {
    // Public examples and editable installation scripts belong to their
    // contributing features, not to the README build provider.
    if (state.source.kind === "file") {
      changes.push({
        kind: "remove-file",
        path: readmeBuildSourcePath,
        expectedDigest: state.source.digest,
      });
    }
  } else {changes.push({
      kind: "remove-directory",
      path: readmeBuildDirectoryPath,
      expectedStateDigest: state.directory.stateDigest,
    });}
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
  const writableMode = repairFileMode(state.root, 0o644);
  const readonlyMode = repairFileMode(state.root, 0o444);
  const unlock = !state.rootMatches && !fileAccess(state.root).writable;
  if (unlock) {
    changes.push({
      kind: "set-file-mode",
      path: readmeBuildRootPath,
      mode: writableMode,
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
  if (unlock || fileAccess(state.root).writable) {
    changes.push({
      kind: "set-file-mode",
      path: readmeBuildRootPath,
      mode: readonlyMode,
      expectedMode: unlock ? writableMode : state.root.mode,
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
