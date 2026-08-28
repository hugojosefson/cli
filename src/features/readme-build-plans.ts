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
  const initialSource = state.source.kind === "file"
    ? state.source.content
    : state.initialSource;
  const sourceContent = buildSourceContent(context, initialSource);
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
  return plan(
    "enable",
    allowed,
    changes,
    "Configure generated README output.",
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
