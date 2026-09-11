/** @module Release-version changes for Deno JSON and JSONC configuration. */

import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";
import type { DenoConfigPath } from "../features/deno-config.ts";
import { parseSemver } from "./semver.ts";

/** Replaces the top-level version without discarding JSONC comments or layout. */
export function updateDenoConfigVersion(
  path: DenoConfigPath,
  text: string,
  version: string,
): string {
  if (!parseSemver(version)) {
    throw new TypeError("Release version must be SemVer.");
  }
  const errors: ParseError[] = [];
  const value = parse(text, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (
    errors.length > 0 || !value || typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new TypeError(`${path} is not a JSON or JSONC object.`);
  }
  if (typeof (value as { version?: unknown }).version !== "string") {
    throw new TypeError(`${path} has no string version.`);
  }
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  return applyEdits(
    text,
    modify(text, ["version"], version, {
      formattingOptions: { insertSpaces: true, tabSize: 2, eol },
    }),
  );
}
