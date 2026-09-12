/** @module Exact task and workflow differences that prevent legacy migration. */

import type { DetectionIssue } from "../api/feature-detection.ts";
import type { inspectLegacyRelease } from "./github-release-legacy.ts";
import { workflowDetectionIssue } from "./workflow-detection-issue.ts";
import { valueDifference } from "./detection-differences.ts";

type Bundle = Extract<
  Awaited<ReturnType<typeof inspectLegacyRelease>>,
  { kind: "custom" | "exact" }
>;

export function legacyReleaseDifferences(bundle: Bundle): DetectionIssue[] {
  const issues: DetectionIssue[] = bundle.workflow.result !== "matches"
    ? [workflowDetectionIssue(bundle.workflow)]
    : [];
  const path = bundle.config.kind === "config"
    ? bundle.config.path
    : "deno.json";
  const add = (observation: string) =>
    issues.push({
      code: "legacy-release-task-conflict",
      kind: "deno-task",
      subject: { kind: "repository-path", identifier: path },
      observation,
      resolution:
        "Keep custom release commands. Automatic migration requires the unchanged git-hj-init Deno tasks and workflow.",
    });
  if (bundle.config.kind !== "config") {
    add(
      bundle.config.kind === "ambiguous"
        ? bundle.config.observation
        : "Expected a Deno configuration with the git-hj-init release tasks. Found no deno.json and no deno.jsonc.",
    );
    return issues;
  }
  const actual = Object.fromEntries(bundle.entries);
  for (const [name, expected] of Object.entries(bundle.expected)) {
    const value = actual[name];
    if (
      typeof value === "string" && value.trimStart() === expected.trimStart()
    ) continue;
    add(
      valueDifference(
        path,
        `tasks.${name}`,
        `the command ${JSON.stringify(expected.trimStart())}`,
        value,
      ),
    );
  }
  for (const [name] of bundle.entries) {
    if (!(name in bundle.expected)) {
      add(
        `${path}: expected only the git-hj-init release task names. Found additional task ${name}.`,
      );
    }
  }
  if (bundle.referenced) {
    add(
      `${path}: expected no custom task references to legacy release tasks. Found references in ${
        bundle.referencingTasks.map((name) => `tasks.${name}`).join(", ")
      }.`,
    );
  }
  return issues;
}
