/** @module Generated README operation safety checks. */

import { layoutBadges } from "../readme/badge-layout.ts";
import { fileAccess } from "../repository/file-access.ts";
import type {
  OperationCheck,
  OperationWarning,
} from "../api/feature-operation.ts";
import type { OperationContext } from "../api/repository-context.ts";
import { sameJson } from "../operations/local-plan-state.ts";
import { denoTaskDefinitions, readmeTaskDefinition } from "./deno-tasks.ts";
import {
  inspectReadmeBuild,
  readmeBuildDirectoryPath,
  readmeBuildFeatureId,
  readmeBuildRootPath,
} from "./readme-build-state.ts";

export async function checkEnableReadmeBuild(
  context: OperationContext,
): Promise<OperationCheck> {
  const state = await inspectReadmeBuild(context);
  if (
    exact(state) && state.source.kind === "file" &&
    layoutBadges(state.source.content) === state.source.content
  ) {
    return noOp("Generated README is already adopted.");
  }
  if (state.legacy.kind === "conflict") return blocked(state.legacy.reason);
  if (state.legacy.kind === "recognized") {
    if (
      !state.defaultUsable ||
      state.root.kind !== "file" && state.root.kind !== "absent"
    ) {
      return blocked("Legacy README output or default task conflicts.");
    }
    if (!repairSelected(context)) {
      return blocked(
        "Legacy README generation differs. Re-run with --repair to migrate it.",
      );
    }
    return allowed([{
      code: "readme-build-migrate",
      message: legacyReadmePreview(state),
      subjects: [{ kind: "repository-path", identifier: readmeBuildRootPath }],
      requiresConfirmation: true,
    }]);
  }
  if (state.taskPresent || state.generatedMarker) {
    if (
      state.source.kind !== "file" || state.output === undefined ||
      !state.taskUsable || !state.defaultUsable ||
      state.root.kind !== "file" && state.root.kind !== "absent"
    ) {
      return blocked("Generated README ownership is ambiguous.");
    }
    return repairSelected(context) ? allowed() : blocked(
      "Generated README differs. Re-run with --repair to restore generated artifacts.",
    );
  }
  if (
    state.source.kind !== "absent" ||
    state.directory.kind !== "absent" &&
      !(state.directory.kind === "directory" &&
        await context.files.exists(".hj/readme.json"))
  ) {
    return blocked(
      "readme/ already exists and is not owned by the generated README feature.",
    );
  }
  if (state.configKind === "ambiguous") {
    return blocked("The Deno configuration is ambiguous.");
  }
  if (state.configKind === "absent" && !denoFmtWillEnable(context)) {
    return blocked("The Deno configuration is absent.");
  }
  if (state.configPath && !state.taskUsable && !denoFmtWillEnable(context)) {
    return blocked("The Deno tasks entry is ambiguous.");
  }
  if (
    state.configPath && state.defaultValue !== undefined &&
    !sameJson(
      state.defaultValue,
      denoTaskDefinitions(state.taskIds).default,
    ) && !denoFmtWillEnable(context)
  ) {
    return blocked(
      "The default Deno task conflicts. Repair Deno formatting before enabling generated README support.",
    );
  }
  if (
    state.root.kind !== "absent" &&
    (state.root.kind !== "file" || !fileAccess(state.root).writable)
  ) {
    return blocked("README.md must be an absent or writable regular file.");
  }
  return allowed();
}

export async function checkDisableReadmeBuild(
  context: OperationContext,
): Promise<OperationCheck> {
  const state = await inspectReadmeBuild(context);
  if (
    !state.taskPresent && state.source.kind === "absent" &&
    !state.generatedMarker
  ) {
    return noOp("Generated README is absent.");
  }
  if (!exact(state) || state.directory.kind !== "directory") {
    return blocked("Generated README ownership is ambiguous.");
  }
  const status = await context.git.isRepository()
    ? await context.git.status([readmeBuildDirectoryPath], {
      includeIgnored: true,
    })
    : undefined;
  const warnings: OperationWarning[] = !status || !status.isClean
    ? [{
      code: "readme-build-remove",
      message: "Removing readme/ requires confirmation.",
      subjects: [{
        kind: "repository-path",
        identifier: readmeBuildDirectoryPath,
      }],
      requiresConfirmation: true,
    }]
    : [];
  return allowed(warnings);
}

function exact(state: Awaited<ReturnType<typeof inspectReadmeBuild>>): boolean {
  return state.exactTask && state.exactDefault &&
    state.source.kind === "file" && state.rootMatches &&
    state.root.kind === "file" && !fileAccess(state.root).writable &&
    fileAccess(state.source).writable;
}

function repairSelected(context: OperationContext): boolean {
  return context.repair?.kind === "all-drifted" ||
    context.repair?.kind === "features" &&
      context.repair.featureIds.includes(readmeBuildFeatureId);
}

function denoFmtWillEnable(context: OperationContext): boolean {
  return context.resolvedChanges.some((change) =>
    change.featureId === "deno-fmt" && change.enabled
  );
}

function allowed(warnings: readonly OperationWarning[] = []): OperationCheck {
  return { result: "allowed", warnings, preconditions: [] };
}

function noOp(reason: string): OperationCheck {
  return { result: "no-op", reason, warnings: [] };
}

function blocked(message: string): OperationCheck {
  return {
    result: "blocked",
    blockers: [{
      code: "readme-build-conflict",
      message,
      subjects: [{ kind: "repository-path", identifier: readmeBuildRootPath }],
      resolution: "Resolve the README build artifacts before retrying.",
    }],
    warnings: [],
  };
}

export function legacyReadmePreview(
  state: Awaited<ReturnType<typeof inspectReadmeBuild>>,
): string {
  return "Replace the git-hj-init README task and quoted include directives. " +
    "Preserve existing source scripts and public exports.\n" +
    `Replace tasks.readme: ${JSON.stringify(state.taskValue)}\n` +
    `With tasks.readme: ${JSON.stringify(readmeTaskDefinition)}\n` +
    "--- README.md before\n" +
    (state.root.kind === "file" ? state.root.content : "(absent)\n") +
    "\n+++ README.md after\n" + state.output;
}
