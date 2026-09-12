/** @module README build issue subjects. */

import type { DetectionIssue } from "../api/feature-detection.ts";

export function readmeBuildIssue(
  path: string,
  observation: string,
  resolution: string,
): DetectionIssue {
  return {
    code: "readme-build-ambiguous",
    kind: "readme-build",
    subject: { kind: "repository-path", identifier: path },
    observation,
    resolution,
  };
}
