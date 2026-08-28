/** @module Canonical JSR package configuration values. */

import type { JsonObject } from "../api/json.ts";

export const jsrPackageFeatureId = "jsr-package";
export const publishCheckName = "publish-check";
export const publishCheckDefinition: JsonObject = {
  description: "Check JSR publication.",
  command: "deno publish --dry-run --check=all",
};
