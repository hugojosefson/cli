/** @module Generated README feature detection. */

import { readmeBuildIssues } from "./readme-build-issues.ts";
import { badgeLayoutDetection } from "./readme-badge-layout.ts";
import { fileAccess } from "../repository/file-access.ts";
import type {
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
  const issues = await readmeBuildIssues(state, context);
  if (issues.length) {
    return { state: "ambiguous", evidence, issues };
  }
  if (
    state.exactTask && state.exactDefault && state.rootMatches &&
    state.root.kind === "file" && !fileAccess(state.root).writable &&
    state.source.kind === "file" && fileAccess(state.source).writable
  ) {
    const badges = badgeLayoutDetection(
      state.source.content,
      "readme/README.md",
    );
    if (badges) return badges;
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
