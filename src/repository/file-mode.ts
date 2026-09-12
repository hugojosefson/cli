/** @module Portable normalization of repository file modes. */

import type { FileMode } from "../api/json.ts";

/** Returns only Unix permission bits, or zero when the platform omits modes. */
export function fileMode(info: { readonly mode: number | null }): FileMode {
  return (info.mode ?? 0) & 0o777;
}
