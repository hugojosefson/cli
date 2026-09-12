/** @module Generated README feature detection. */

import type {
  DetectionEvidence,
  DetectionIssue,
  FeatureDetection,
} from "../api/feature-detection.ts";
import type { DetectionContext } from "../api/repository-context.ts";
import {
  inspectReadmeBuild,
  readmeBuildRootPath,
} from "./readme-build-state.ts";

/** Detects exact generated README source, task, aggregate, output, and mode. */
export async function detectReadmeBuild(
  context: DetectionContext,
): Promise<FeatureDetection> {
  const state = await inspectReadmeBuild(context);
  const evidence = [{
    code: "readme-build-inspected",
    kind: "readme-build",
    subject: subject(),
    observation: "README build artifacts were inspected.",
  }];
  if (
    !state.taskPresent && state.source.kind === "absent" &&
    !state.generatedMarker
  ) {
    return {
      state: "disabled" as const,
      evidence: [{
        ...evidence[0],
        observation: "README build source and task are absent.",
      }],
    };
  }
  if (state.legacy.kind === "conflict") {
    return ambiguous(evidence, state.legacy.reason);
  }
  if (state.source.kind !== "file" || state.output === undefined) {
    return ambiguous(evidence, "The generated README source is unsafe.");
  }
  if (state.root.kind !== "file" && state.root.kind !== "absent") {
    return ambiguous(evidence, "The generated README output path is unsafe.");
  }
  if (!state.taskUsable || !state.defaultUsable) {
    return ambiguous(evidence, "The generated README tasks are ambiguous.");
  }
  if (
    state.exactTask && state.exactDefault && state.rootMatches &&
    state.rootMode === 0o444
  ) {
    return {
      state: "enabled" as const,
      evidence: [{
        ...evidence[0],
        observation: "Generated README matches its source and build task.",
      }],
    };
  }
  return {
    state: "drifted" as const,
    evidence,
    issues: [issue("Generated README task, content, or mode differs.")],
  };
}

function ambiguous(
  evidence: readonly DetectionEvidence[],
  observation: string,
): FeatureDetection {
  return {
    state: "ambiguous" as const,
    evidence,
    issues: [issue(observation)],
  };
}

function issue(observation: string): DetectionIssue {
  return {
    code: "readme-build-ambiguous",
    kind: "readme-build",
    subject: subject(),
    observation,
    resolution:
      "Restore a regular readme/README.md source and exact generated README tasks.",
  };
}

function subject() {
  return { kind: "repository-path", identifier: readmeBuildRootPath };
}
