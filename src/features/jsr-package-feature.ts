/** @module JSR package feature declaration. */

import type { Feature } from "../api/feature.ts";
import { jsrPackageFeatureId } from "./jsr-package-config.ts";
import { inspectJsrPackage } from "./jsr-package-inspection.ts";
import {
  checkDisableJsrPackage,
  checkEnableJsrPackage,
} from "./jsr-package-operations.ts";
import {
  planDisableJsrPackage,
  planEnableJsrPackage,
} from "./jsr-package-plans.ts";

/** Adds JSR package metadata and an owned `deno publish` dry-run task. */
export const jsrPackageFeature: Feature = {
  metadata: {
    id: jsrPackageFeatureId,
    name: "JSR package",
    summary: "Adds JSR package metadata and publishing checks.",
  },
  dependencies: {
    requires: [{
      featureId: "deno-fmt",
      reason: "JSR packages require Deno formatting.",
    }, {
      featureId: "github-repo",
      reason: "JSR package identity comes from the linked GitHub repository.",
    }],
  },
  capabilities: {
    provides: [],
    requires: [
      {
        capabilityId: "deno-export",
        reason: "JSR packages require a Deno export.",
      },
      { capabilityId: "readme", reason: "JSR packages require a README." },
      { capabilityId: "license", reason: "JSR packages require a license." },
    ],
  },
  detect: async (context) => {
    const state = await inspectJsrPackage(context);
    if (state.state === "enabled" || state.state === "disabled") {
      return { state: state.state, evidence: [] };
    }
    return {
      state: state.state,
      evidence: [],
      issues: [{
        code: `jsr-package-${state.state}`,
        kind: "jsr-package",
        subject: {
          kind: "repository-path",
          identifier: "deno.json|deno.jsonc",
        },
        observation: state.observation,
        resolution: state.state === "drifted"
          ? "Use --repair to restore owned values."
          : "Resolve the conflicting configuration.",
      }],
    };
  },
  checkEnable: checkEnableJsrPackage,
  planEnable: planEnableJsrPackage,
  checkDisable: checkDisableJsrPackage,
  planDisable: planDisableJsrPackage,
};
