import type { OperationContext } from "../api/repository-context.ts";
import { denoServerFeatureId } from "./deno-server-artifacts.ts";

/** Uses an operation's resolved server state when it explicitly changes server. */
export function resolvedServerEnabled(
  context: OperationContext,
  current: boolean,
): boolean {
  return context.resolvedChanges.find((change) =>
    change.featureId === denoServerFeatureId
  )?.enabled ?? current;
}

export function resolvedCliEnabled(
  context: OperationContext,
  current: boolean,
): boolean {
  return context.resolvedChanges.find((change) =>
    change.featureId === "deno-cli"
  )?.enabled ?? current;
}
