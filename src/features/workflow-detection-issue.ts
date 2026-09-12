/** @module Workflow conflicts with their inspected paths and expected templates. */

import type { ExactArtifactInspection } from "../api/artifact-inspection.ts";
import type { DetectionIssue } from "../api/feature-detection.ts";
import { artifactDifference } from "./detection-differences.ts";

export function workflowDetectionIssue(
  inspection: ExactArtifactInspection,
  marker?: string,
): DetectionIssue {
  return {
    code: "workflow-conflict",
    kind: "github-workflow",
    subject: { kind: "repository-path", identifier: inspection.schema.path },
    observation: artifactDifference(inspection, marker),
    resolution:
      `Keep intentional custom behavior in a different workflow path before adopting the managed ${inspection.schema.path} template. Automatic replacement of custom workflows is unavailable.`,
  };
}
