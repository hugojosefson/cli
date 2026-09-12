/** @module Filesystem failure classification shared by the supported runtimes. */
export function isNotFound(error: unknown): boolean {
  return error instanceof Error &&
    (("code" in error && error.code === "ENOENT") || error.name === "NotFound");
}
