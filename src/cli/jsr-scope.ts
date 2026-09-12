/** @module Explicit scope selection and authenticated JSR membership discovery. */
import type { DetectionContext } from "../api/repository-context.ts";
import {
  readPackageMetadata,
  validJsrName,
  validScope,
} from "../package/metadata.ts";
import type { JsrScopeReader } from "../repository/jsr-scope-reader.ts";

export type JsrScopePrompt = (scopes: readonly string[]) => string | null;

/** An empty answer never selects the first scope, including with --yes. */
export function promptJsrScope(scopes: readonly string[]): string | null {
  if (!Deno.stdin.isTerminal()) return null;
  return globalThis.prompt(`Select a JSR scope (${scopes.join(", ")})`);
}

export async function resolveJsrScope(
  context: DetectionContext,
  reader: JsrScopeReader,
  explicit: string | undefined,
  prompt: JsrScopePrompt | undefined,
): Promise<{ readonly jsrScope: string }> {
  const metadata = await readPackageMetadata(context);
  if (metadata.configured && !validJsrName(metadata.name)) {
    throw new Error(
      "Set an explicit scoped JSR name in deno.json or deno.jsonc.",
    );
  }
  const configured = metadata.configured
    ? metadata.name.split("/")[0].slice(1)
    : undefined;
  if (explicit !== undefined && !validScope(explicit)) {
    throw new Error("--jsr-scope requires a valid JSR scope name without @.");
  }
  if (configured && explicit && explicit !== configured) {
    throw new Error(
      "--jsr-scope conflicts with the configured package name. Change deno.json or deno.jsonc first.",
    );
  }
  const selected = configured ?? explicit;
  const result = await reader.scopes();
  if (result.kind === "missing-authentication") {
    // Explicit local setup can proceed without a registry session.
    if (selected) return { jsrScope: selected };
    throw new Error(
      "JSR scope discovery is unresolved: set JSR_TOKEN to a JSR user token, or supply --jsr-scope=<scope> or a scoped package name in deno.json.",
    );
  }
  if (result.kind === "unavailable") {
    throw new Error(`JSR scope discovery is unresolved: ${result.observation}`);
  }
  if (selected) {
    if (!result.scopes.includes(selected)) {
      throw new Error(
        `The authenticated JSR user is not a member of scope ${selected}. Available scopes: ${
          result.scopes.join(", ") || "none"
        }.`,
      );
    }
    return { jsrScope: selected };
  }
  if (result.scopes.length === 0) {
    throw new Error(
      "A JSR scope is needed. Join or create a scope on jsr.io, then run setup again. No scopes were created.",
    );
  }
  if (result.scopes.length === 1) return { jsrScope: result.scopes[0] };
  const choice = prompt?.(result.scopes)?.trim();
  if (choice && result.scopes.includes(choice)) return { jsrScope: choice };
  throw new Error(
    `Select a JSR scope with --jsr-scope=<scope>. Available scopes: ${
      result.scopes.join(", ")
    }.`,
  );
}
