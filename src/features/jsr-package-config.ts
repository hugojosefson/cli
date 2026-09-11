/** @module Canonical JSR package configuration values. */

import type { JsonObject } from "../api/json.ts";

export const jsrPackageFeatureId = "jsr-package";
export const publishCheckName = "publish-check";
export const jsrPublishCheckArgs = [
  "publish",
  "--dry-run",
  "--allow-dirty",
  "--check=all",
] as const;
export const publishCheckDefinition: JsonObject = {
  description: "Check JSR publication.",
  command: ["deno", ...jsrPublishCheckArgs].join(" "),
};
/** Recognize the old task so repair can update existing generated projects. */
export const legacyPublishCheckDefinition: JsonObject = {
  description: "Check JSR publication.",
  command: "deno publish --dry-run --check=all",
};
