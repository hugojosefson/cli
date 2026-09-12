/** @module Authoritative configured identity with a directory-name fallback. */

import type {
  DetectionContext,
  OperationContext,
} from "../api/repository-context.ts";
import {
  readPackageMetadata,
  validJsrName,
  validScope,
} from "../package/metadata.ts";

export type JsrPackageIdentity =
  | { readonly kind: "available"; readonly name: string }
  | { readonly kind: "unavailable"; readonly observation: string };

/** Keeps configured names; only a missing name uses directory and the resolved JSR scope. */
export async function jsrPackageIdentity(
  context: DetectionContext & Partial<Pick<OperationContext, "options">>,
): Promise<JsrPackageIdentity> {
  try {
    const metadata = await readPackageMetadata(context);
    if (metadata.configured) {
      return validJsrName(metadata.name)
        ? { kind: "available", name: metadata.name }
        : {
          kind: "unavailable",
          observation:
            "Set an explicit scoped JSR name in deno.json or deno.jsonc.",
        };
    }
    const scope = context.options?.jsrScope;
    if (typeof scope !== "string" || !validScope(scope)) {
      return {
        kind: "unavailable",
        observation:
          "JSR scope discovery is unresolved. Supply --jsr-scope=<scope>, authenticate with JSR_TOKEN, or set an explicit scoped name in deno.json or deno.jsonc.",
      };
    }
    return { kind: "available", name: `@${scope}/${metadata.name}` };
  } catch (error) {
    return {
      kind: "unavailable",
      observation: error instanceof Error ? error.message : String(error),
    };
  }
}
