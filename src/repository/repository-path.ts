/** @module Safe conversion of repository-relative paths to file URLs. */

import { fromFileUrl } from "@std/path";
import type { RepositoryPath } from "../api/json.ts";

export interface RepositoryRoot {
  readonly url: URL;
  readonly path: string;
}

/** Validates a local repository root and normalizes its directory URL. */
export function repositoryRoot(root: URL): RepositoryRoot {
  if (root.protocol !== "file:" || root.search || root.hash) {
    throw new TypeError("Repository root must be a plain file URL.");
  }
  const url = new URL(root.href.endsWith("/") ? root.href : `${root.href}/`);
  return { url, path: fromFileUrl(url) };
}

/** Resolves a strictly relative repository path below a repository root. */
export function repositoryUrl(root: RepositoryRoot, path: RepositoryPath): URL {
  if (
    path.length === 0 || path.includes("\0") || path.startsWith("/") ||
    path.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(path)
  ) {
    throw new TypeError(`Repository path must be relative: ${path}`);
  }
  const parts = path.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new TypeError(`Repository path must not traverse: ${path}`);
  }
  return new URL(parts.map(encodeURIComponent).join("/"), root.url);
}
