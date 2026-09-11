/** @module Built-in Deno server feature declaration and detection. */

import type { DetectionIssue } from "../api/feature-detection.ts";
import type { DetectionContext } from "../api/repository-context.ts";
import type { Feature } from "../api/feature.ts";
import { inspectDenoConfig } from "./deno-config.ts";
import { isObject } from "./deno-tasks.ts";
import {
  checkDisableDenoServer,
  checkEnableDenoServer,
} from "./deno-server-operations.ts";
import {
  denoServerExport,
  denoServerFeatureId,
  denoServerSubject,
  inspectDenoServerArtifacts,
} from "./deno-server-artifacts.ts";
import {
  planDisableDenoServer,
  planEnableDenoServer,
} from "./deno-server-plans.ts";

async function detectDenoServer(context: DetectionContext) {
  const config = await inspectDenoConfig(context);
  if (config.kind === "absent") {
    return simple("disabled", "The managed ./server export is absent.");
  }
  if (config.kind === "ambiguous") {
    return issue("ambiguous", config.observation);
  }
  if (!isObject(config.value.exports)) {
    return config.value.exports === undefined
      ? simple("disabled", "The managed ./server export is absent.")
      : issue("ambiguous", "The Deno exports entry is not an object.");
  }
  if (config.value.exports["./server"] === undefined) {
    return simple("disabled", "The managed ./server export is absent.");
  }
  if (config.value.exports["./server"] !== denoServerExport) {
    return issue("drifted", "The server export differs.");
  }
  const invalid = (await inspectDenoServerArtifacts(context)).find((item) =>
    item.result !== "matches"
  );
  if (!invalid) {
    return simple("enabled", "Server export and starter files are adopted.");
  }
  const ambiguous = invalid.result === "unreadable" ||
    invalid.result === "differs" && invalid.observation.kind !== "file";
  return issue(
    ambiguous ? "ambiguous" : "drifted",
    `Starter file ${invalid.schema.path} does not exactly match.`,
  );
}

function simple(state: "enabled" | "disabled", observation: string) {
  return {
    state,
    evidence: [{
      code: `deno-server-${state}`,
      kind: "deno-server",
      subject: denoServerSubject(),
      observation,
    }],
  };
}

function issue(state: "drifted" | "ambiguous", observation: string) {
  const item: DetectionIssue = {
    code: `deno-server-${state}`,
    kind: "deno-server",
    subject: denoServerSubject(),
    observation,
    resolution: state === "drifted"
      ? "Use --repair to restore exact contributed content and mode."
      : "Resolve the conflicting path or configuration, then retry.",
  };
  return {
    state,
    evidence: [{
      code: "deno-server-inspected",
      kind: "deno-server",
      subject: denoServerSubject(),
      observation,
    }],
    issues: [item],
  };
}

/** Adds a dependency-free Deno.serve starter and its export. */
export const denoServerFeature: Feature = {
  metadata: {
    id: denoServerFeatureId,
    name: "Deno server",
    summary: "Creates a minimal Deno.serve server.",
  },
  dependencies: {
    requires: [{
      featureId: "deno-fmt",
      reason: "Deno servers require Deno formatting.",
    }],
  },
  capabilities: { provides: ["deno-export"], requires: [] },
  detect: detectDenoServer,
  checkEnable: checkEnableDenoServer,
  planEnable: planEnableDenoServer,
  checkDisable: checkDisableDenoServer,
  planDisable: planDisableDenoServer,
};
