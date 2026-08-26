/** @module Contained local state checks used by the plan applicator. */

import type { JsonValue, RepositoryPath } from "../api/json.ts";
import {
  type RepositoryRoot,
  repositoryUrl,
} from "../repository/repository-path.ts";

export async function containedUrl(
  root: RepositoryRoot,
  path: RepositoryPath,
): Promise<URL> {
  const url = repositoryUrl(root, path);
  const parts = path.split("/");
  let parent = root.url;
  for (const part of parts.slice(0, -1)) {
    parent = new URL(`${encodeURIComponent(part)}/`, parent);
    try {
      if ((await Deno.lstat(parent)).isSymlink) {
        throw new TypeError("Repository path traverses a symlink.");
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return url;
      }
      throw error;
    }
  }
  return url;
}

export async function linkTarget(url: URL): Promise<string | undefined> {
  try {
    const info = await Deno.lstat(url);
    return info.isSymlink ? await Deno.readLink(url) : undefined;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
}

export function sameJson(
  left: JsonValue | undefined,
  right: JsonValue | undefined,
): boolean {
  if (left === right) return true;
  if (
    left === undefined || right === undefined || left === null || right === null
  ) return false;
  if (typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length && left.every((value, index) =>
        sameJson(value, right[index])
      );
  }
  const leftObject = left as { readonly [key: string]: JsonValue };
  const rightObject = right as { readonly [key: string]: JsonValue };
  const leftKeys = Object.keys(leftObject).sort();
  const rightKeys = Object.keys(rightObject).sort();
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) =>
      key === rightKeys[index] && sameJson(leftObject[key], rightObject[key])
    );
}
