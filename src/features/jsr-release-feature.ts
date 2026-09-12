/** @module JSR OIDC release workflow feature declaration. */

import { workflowDetectionIssue } from "./workflow-detection-issue.ts";
import type { DetectionIssue } from "../api/feature-detection.ts";
import type { DetectionContext } from "../api/repository-context.ts";
import type { Feature } from "../api/feature.ts";
import {
  inspectJsrReleaseArtifact,
  jsrReleaseFeatureId,
  jsrReleaseMarker,
  jsrReleaseSubject,
} from "./jsr-release-artifacts.ts";
import {
  checkDisableJsrRelease,
  checkEnableJsrRelease,
} from "./jsr-release-operations.ts";
import {
  planDisableJsrRelease,
  planEnableJsrRelease,
} from "./jsr-release-plans.ts";

async function detectJsrRelease(context: DetectionContext) {
  const artifact = await inspectJsrReleaseArtifact(context);
  if (artifact.result === "absent") {
    return state("disabled", "JSR release workflow is absent.");
  }
  if (artifact.result === "matches") {
    return state("enabled", "JSR release workflow is adopted.");
  }
  const custom = artifact.result === "unreadable" ||
    artifact.observation.kind !== "file" ||
    !artifact.observation.content.startsWith(jsrReleaseMarker);
  if (custom) {
    return {
      state: "ambiguous" as const,
      evidence: [],
      issues: [workflowDetectionIssue(artifact, jsrReleaseMarker)],
    };
  }
  return issue(
    custom ? "ambiguous" : "drifted",
    custom
      ? "The JSR release workflow is custom."
      : "The generated JSR release workflow differs.",
  );
}

function state(state: "enabled" | "disabled", observation: string) {
  return {
    state,
    evidence: [{
      code: `jsr-release-${state}`,
      kind: "jsr-release",
      subject: jsrReleaseSubject(),
      observation,
    }],
  };
}
function issue(state: "drifted" | "ambiguous", observation: string) {
  const issue: DetectionIssue = {
    code: `jsr-release-${state}`,
    kind: "jsr-release",
    subject: jsrReleaseSubject(),
    observation,
    resolution: state === "drifted"
      ? "Use --repair to restore the generated workflow."
      : "Resolve the custom workflow conflict manually.",
  };
  return { state, evidence: [], issues: [issue] };
}

/** Publishes through JSR OIDC after validating the pushed SemVer tag. */
export const jsrReleaseFeature: Feature = {
  metadata: {
    id: jsrReleaseFeatureId,
    name: "JSR release",
    summary: "Adds a JSR OIDC publishing workflow.",
  },
  dependencies: {
    requires: [{
      featureId: "jsr-package",
      reason: "JSR release publishes a JSR package.",
    }, {
      featureId: "github-protected-tags",
      reason: "JSR release requires protected release tags.",
    }],
  },
  capabilities: { provides: [], requires: [] },
  detect: detectJsrRelease,
  checkEnable: checkEnableJsrRelease,
  planEnable: planEnableJsrRelease,
  checkDisable: checkDisableJsrRelease,
  planDisable: planDisableJsrRelease,
};
