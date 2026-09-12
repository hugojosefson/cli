/** @module Authoritative configured identity with a directory-name fallback. */

import type { DetectionContext } from "../api/repository-context.ts";
import {
  readPackageMetadata,
  validJsrName,
  validScope,
} from "../package/metadata.ts";

export type JsrPackageIdentity =
  | { readonly kind: "available"; readonly name: string }
  | { readonly kind: "unavailable"; readonly observation: string };

/** Keeps configured names; only a missing name uses directory and GitHub scope. */
export async function jsrPackageIdentity(
  context: DetectionContext,
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
    const repository = await context.github?.repository();
    const scope = repository?.owner.toLowerCase();
    if (!scope || !validScope(scope)) {
      return {
        kind: "unavailable",
        observation:
          "A JSR scope cannot be derived from GitHub. Set an explicit scoped name in deno.json or deno.jsonc.",
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
