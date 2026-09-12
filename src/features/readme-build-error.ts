/** @module README build failures without arbitrary exception content. */

import { fromFileUrl, relative } from "@std/path";

export function readmeBuildError(error: unknown, root: URL): string {
  if (error instanceof Error) {
    const failure = error as Error & { code?: string; path?: string };
    if (
      ["ENOENT", "EACCES", "ENOTDIR", "EISDIR"].includes(failure.code ?? "")
    ) {
      const path = failure.path
        ? relative(fromFileUrl(root), failure.path)
        : "readme/README.md";
      return `Expected a readable README source and include files. Found ${failure.code} at ${path}.`;
    }
    if (
      /^(?:README path |Circular README include:|Missing README include:|Unknown package reference:|Set an explicit scoped JSR name)/
        .test(error.message)
    ) {
      return `Expected valid README includes and package references. Found: ${error.message}`;
    }
  }
  return "Expected README output. Found an unclassified build error. Use hj readme build to examine the source failure.";
}
