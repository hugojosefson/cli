/** @module JSR package operation safety checks. */

import { jsrPackageIdentity } from "./jsr-package-identity.ts";
import type { OperationCheck } from "../api/feature-operation.ts";
import type { OperationContext } from "../api/repository-context.ts";
import { jsrPackageFeatureId } from "./jsr-package-config.ts";
import { inspectJsrPackage } from "./jsr-package-inspection.ts";

const exportProviders = new Set(["deno-cli", "deno-lib", "deno-server"]);

export async function checkEnableJsrPackage(
  context: OperationContext,
): Promise<OperationCheck> {
  const configured = await inspectJsrPackage(context);
  if (configured.state === "enabled" && !repairSelected(context)) {
    return { result: "no-op", reason: configured.observation, warnings: [] };
  }
  const state = await inspectJsrPackage(context, true);
  if (state.state === "ambiguous") return blocked(state.observation);
  if (state.state === "enabled") {
    return { result: "no-op", reason: state.observation, warnings: [] };
  }
  const identity = await jsrPackageIdentity(context);
  if (identity.kind !== "available") return blocked(identity.observation);
  if (state.state === "drifted") {
    const repairable = state.repairs.filter((item) => item !== "Deno export");
    if (repairable.length > 0 && !repairSelected(context)) {
      return blocked(
        `${state.observation} Re-run with --repair to restore owned values.`,
      );
    }
    if (state.missingExport && !enablesExportProvider(context)) {
      return blocked(
        "A Deno export is missing and no enabling deno-export provider is resolved.",
      );
    }
  }
  return { result: "allowed", warnings: [], preconditions: [] };
}

export async function checkDisableJsrPackage(
  context: OperationContext,
): Promise<OperationCheck> {
  const state = await inspectJsrPackage(context, true);
  if (state.state === "ambiguous") return blocked(state.observation);
  if (state.state === "drifted") {
    return blocked("Owned JSR package values differ and cannot be removed.");
  }
  if (state.state === "disabled") {
    return { result: "no-op", reason: state.observation, warnings: [] };
  }
  return { result: "allowed", warnings: [], preconditions: [] };
}

function enablesExportProvider(context: OperationContext): boolean {
  return context.resolvedChanges.some((change) =>
    change.enabled && exportProviders.has(change.featureId)
  );
}
function repairSelected(context: OperationContext): boolean {
  return context.repair?.kind === "all-drifted" ||
    context.repair?.kind === "features" &&
      context.repair.featureIds.includes(jsrPackageFeatureId);
}
function blocked(message: string): OperationCheck {
  return {
    result: "blocked",
    blockers: [{
      code: "jsr-package-conflict",
      message,
      subjects: [{
        kind: "repository-path",
        identifier: "deno.json|deno.jsonc",
      }],
      resolution:
        "Resolve the configuration conflict or select --repair for exact owned values.",
    }],
    warnings: [],
  };
}
