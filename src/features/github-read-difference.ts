/** @module Expected GitHub resources and classified read failures. */

import type { DetectionContext } from "../api/repository-context.ts";
import { valueType } from "./detection-differences.ts";

export function githubReadDifference(
  context: DetectionContext,
  resource: string,
  expected: string,
  value?: unknown,
): string {
  const diagnostics = context.github?.diagnostics ?? [];
  return `${resource}: expected ${expected}. Found ${
    value === undefined ? "no usable API response" : valueType(value)
  }.` +
    (value === undefined && diagnostics.length
      ? ` ${diagnostics.join(" ")}`
      : "");
}

export function githubReadResolution(context: DetectionContext): string {
  const messages = context.github?.diagnostics ?? [];
  if (messages.some((message) => message.includes("plan or visibility"))) {
    return "Use a GitHub plan that supports the named resource, or keep that resource unmanaged in this repository.";
  }
  if (messages.some((message) => message.includes("rate limit"))) {
    return "Wait until GitHub permits API requests, then try inspection again.";
  }
  return "Use gh auth status to examine GitHub access. Correct access to the named resource before changing its settings.";
}
