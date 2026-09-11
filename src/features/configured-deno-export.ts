/** Read an explicitly declared CLI entry point without executing source. */
import type { DetectionContext } from "../api/repository-context.ts";
import type { JsonValue } from "../api/json.ts";
import { isObject } from "./deno-tasks.ts";

export async function configuredDenoCli(
  context: DetectionContext,
  exports: JsonValue | undefined,
): Promise<boolean> {
  const target = exports !== undefined && isObject(exports)
    ? exports["./cli"]
    : undefined;
  if (typeof target !== "string" || !target.startsWith("./")) return false;
  const path = localModulePath(target);
  if (path === undefined) return false;
  const file = await context.files.observe(path);
  return file.kind === "file" && file.content.trim().length > 0;
}

/** Return a literal module path below the repository root. */
export function localModulePath(target: unknown): string | undefined {
  if (typeof target !== "string" || !target.startsWith("./")) return undefined;
  const path = target.slice(2);
  return path.includes("\\") || path.includes("\0") || path.includes(":") ||
      path.split("/").some((part) => !part || part === "." || part === "..")
    ? undefined
    : path;
}
