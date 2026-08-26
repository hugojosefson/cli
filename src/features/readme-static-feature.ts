/** @module Built-in exact starter README feature. */

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
  if (inspection.result === "matches") {
    return {
      state: "enabled" as const,
      evidence: [{
        code: "readme-static-adopted",
        kind: "readme-static",
        subject: readmeStaticSubject(),
        observation:
          "README.md exactly matches the starter README and is adopted.",
      }],
    };
  }
  const issue = readmeStaticIssue(inspection);
  return {
    state:
      inspection.result === "differs" && inspection.observation.kind === "file"
        ? "drifted" as const
        : "ambiguous" as const,
    evidence: [{
      code: "readme-static-inspected",
      kind: "readme-static",
      subject: readmeStaticSubject(),
      observation: "README.md was inspected against the exact starter README.",
    }],
    issues: [issue],
  };
}

/** Manages only the exact, initial README created for a repository. */
export const readmeStaticFeature: Feature = {
  metadata: {
    id: readmeStaticFeatureId,
    name: "Static README",
    summary: "Creates and owns the exact starter README.md.",
  },
  dependencies: { requires: [] },
  capabilities: { provides: ["readme"], requires: [] },
  detect: detectReadmeStatic,
  checkEnable: checkEnableReadmeStatic,
  planEnable: planEnableReadmeStatic,
  checkDisable: checkDisableReadmeStatic,
  planDisable: planDisableReadmeStatic,
};
