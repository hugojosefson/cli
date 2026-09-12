/** @module Built-in exact starter README feature. */

import { fileAccess } from "../repository/file-access.ts";
import type { Feature } from "../api/feature.ts";
import type { DetectionContext } from "../api/repository-context.ts";
import {
  inspectReadmeStatic,
  readmeStaticFeatureId,
  readmeStaticIssue,
  readmeStaticSubject,
} from "./readme-static-artifact.ts";
import {
  checkDisableReadmeStatic,
  checkEnableReadmeStatic,
  planDisableReadmeStatic,
  planEnableReadmeStatic,
} from "./readme-static-operations.ts";

async function detectReadmeStatic(context: DetectionContext) {
  const inspection = await inspectReadmeStatic(context);
  if (inspection.result === "absent") {
    return {
      state: "disabled" as const,
      evidence: [{
        code: "readme-static-absent",
        kind: "readme-static",
        subject: readmeStaticSubject(),
        observation: "README.md is absent.",
      }],
    };
  }
  if (
    inspection.result !== "unreadable" &&
    inspection.observation.kind === "file" &&
    fileAccess(inspection.observation).writable
  ) {
    return {
      state: "enabled" as const,
      evidence: [{
        code: "readme-static-writable",
        kind: "readme-static",
        subject: readmeStaticSubject(),
        observation: "README.md is a writable static README.",
      }],
    };
  }
  if (
    inspection.result !== "unreadable" && inspection.observation.kind === "file"
  ) {
    return {
      state: "disabled" as const,
      evidence: [{
        code: "readme-static-not-writable",
        kind: "readme-static",
        subject: readmeStaticSubject(),
        observation: "README.md is not writable.",
      }],
    };
  }
  const issue = readmeStaticIssue(inspection);
  return {
    state: "ambiguous" as const,
    evidence: [{
      code: "readme-static-inspected",
      kind: "readme-static",
      subject: readmeStaticSubject(),
      observation: "README.md was inspected against the exact starter README.",
    }],
    issues: [issue],
  };
}

/** Manages a writable root README without claiming generated README files. */
export const readmeStaticFeature: Feature = {
  metadata: {
    id: readmeStaticFeatureId,
    name: "Static README",
    summary: "Provides a writable root README.md.",
  },
  dependencies: { requires: [] },
  capabilities: { provides: ["readme"], requires: [] },
  detect: detectReadmeStatic,
  checkEnable: checkEnableReadmeStatic,
  planEnable: planEnableReadmeStatic,
  checkDisable: checkDisableReadmeStatic,
  planDisable: planDisableReadmeStatic,
};
