/** @module Local library exports and CLI exclusions. */

import type { DetectionContext } from "../api/repository-context.ts";
import type { JsonObject } from "../api/json.ts";
import { localModulePath } from "./configured-deno-export.ts";
import { denoCliExport } from "./deno-cli-artifacts.ts";

export function isDenoLibCliExport(exports: JsonObject): boolean {
  return exports["."] === denoCliExport ||
    exports["./cli"] !== undefined && exports["."] === exports["./cli"];
}

export async function configuredDenoLib(
  context: DetectionContext,
  exports: JsonObject,
): Promise<boolean> {
  if (isDenoLibCliExport(exports)) {
    return false;
  }
  const path = localModulePath(exports["."]);
  if (path === undefined) {
    return false;
  }
  const file = await context.files.observe(path);
  return file.kind === "file" && file.content.trim().length > 0;
}
