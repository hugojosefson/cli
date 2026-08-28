/** @module JSR package identity derived from the authenticated GitHub repository. */

import type { DetectionContext } from "../api/repository-context.ts";

const component = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type JsrPackageIdentity =
  | { readonly kind: "available"; readonly name: string }
  | { readonly kind: "unavailable"; readonly observation: string };

/** Reads and validates the lowercase JSR name for the linked GitHub repository. */
export async function jsrPackageIdentity(
  context: DetectionContext,
): Promise<JsrPackageIdentity> {
  const repository = await context.github?.repository();
  if (!repository) {
    return {
      kind: "unavailable",
      observation: "GitHub repository access is unavailable.",
    };
  }
  const owner = repository.owner.toLowerCase();
  const name = repository.name.toLowerCase();
  if (!component.test(owner) || !component.test(name)) {
    return {
      kind: "unavailable",
      observation:
        "The GitHub owner or repository name is not a JSR-safe lowercase component.",
    };
  }
  return { kind: "available", name: `@${owner}/${name}` };
}
