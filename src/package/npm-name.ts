/** @module Package identity accepted by the native npm publisher. */
export function validNpmPublishName(value: unknown): value is string {
  return typeof value === "string" &&
    /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(value);
}
