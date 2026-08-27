/** @module Built-in Deno lint, type-check, and test task features. */

import { denoTaskFeature } from "./deno-task-feature.ts";

export const denoLintFeature = denoTaskFeature("deno-lint", "Deno linting");
export const denoTypecheckFeature = denoTaskFeature(
  "deno-typecheck",
  "Deno type-checking",
);
export const denoTestFeature = denoTaskFeature("deno-test", "Deno testing");
