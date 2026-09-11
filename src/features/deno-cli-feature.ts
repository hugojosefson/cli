/** @module Built-in Deno CLI feature declaration and detection. */

import type { DetectionIssue } from "../api/feature-detection.ts";
import type { DetectionContext } from "../api/repository-context.ts";
import type { Feature } from "../api/feature.ts";
import { inspectDenoConfig } from "./deno-config.ts";
import { denoServerExport } from "./deno-server-artifacts.ts";
import {
  denoCliExport,
  denoCliFeatureId,
  denoCliSubject,
  inspectDenoCliArtifacts,
} from "./deno-cli-artifacts.ts";
import {
  checkDisableDenoCli,
  checkEnableDenoCli,
} from "./deno-cli-operations.ts";
import { planDisableDenoCli, planEnableDenoCli } from "./deno-cli-plans.ts";
import { isObject } from "./deno-tasks.ts";

async function detectDenoCli(context: DetectionContext) {
  const config = await inspectDenoConfig(context);
  if (config.kind === "absent") {
    return simple("disabled", "The managed ./cli export is absent.");
  }
  if (config.kind === "ambiguous") {
    return issue("ambiguous", config.observation);
  }
  if (!isObject(config.value.exports)) {
    return config.value.exports === undefined
      ? simple("disabled", "The managed ./cli export is absent.")
      : issue("ambiguous", "The Deno exports entry is not an object.");
  }
  if (config.value.exports["./cli"] === undefined) {
    return simple("disabled", "The managed ./cli export is absent.");
  }
  if (config.value.exports["./cli"] !== denoCliExport) {
    return issue("drifted", "The CLI export differs.");
  }
  const serverEnabled = isObject(config.value.exports) &&
    config.value.exports["./server"] === denoServerExport;
  const invalid = (await inspectDenoCliArtifacts(context, serverEnabled)).find((
    item,
  ) => item.result !== "matches");
  if (!invalid) {
    return simple("enabled", "CLI export and executable seed are adopted.");
  }
  const ambiguous = invalid.result === "unreadable" ||
    invalid.result === "differs" && invalid.observation.kind !== "file";
  return issue(
    ambiguous ? "ambiguous" : "drifted",
    `Executable seed ${invalid.schema.path} does not exactly match.`,
  );
}

function simple(state: "enabled" | "disabled", observation: string) {
  return {
    state,
    evidence: [{
      code: `deno-cli-${state}`,
      kind: "deno-cli",
      subject: denoCliSubject(),
      observation,
    }],
  };
}

function issue(state: "drifted" | "ambiguous", observation: string) {
  const item: DetectionIssue = {
    code: `deno-cli-${state}`,
    kind: "deno-cli",
    subject: denoCliSubject(),
    observation,
    resolution: state === "drifted"
      ? "Use --repair to restore exact contributed content and mode."
      : "Resolve the conflicting path or configuration, then retry.",
  };
  return {
    state,
    evidence: [{
      code: "deno-cli-inspected",
      kind: "deno-cli",
      subject: denoCliSubject(),
      observation,
    }],
    issues: [item],
  };
}

/** Adds a Deno CLI export and an exact executable starter file. */
export const denoCliFeature: Feature = {
  metadata: {
    id: denoCliFeatureId,
    name: "Deno CLI",
    summary: "Creates an executable Deno CLI starter.",
  },
  dependencies: {
    requires: [{
      featureId: "deno-fmt",
      reason: "Deno CLIs require Deno formatting.",
    }],
  },
  capabilities: { provides: ["deno-export"], requires: [] },
  detect: detectDenoCli,
  checkEnable: checkEnableDenoCli,
  planEnable: planEnableDenoCli,
  checkDisable: checkDisableDenoCli,
  planDisable: planDisableDenoCli,
};
