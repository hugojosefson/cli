/** @module Built-in Deno library feature declaration and detection. */

import { denoCliExport } from "./deno-cli-artifacts.ts";
import type { DetectionIssue } from "../api/feature-detection.ts";
import type { DetectionContext } from "../api/repository-context.ts";
import type { Feature } from "../api/feature.ts";
import { inspectDenoConfig } from "./deno-config.ts";
import {
  denoLibExport,
  denoLibFeatureId,
  denoLibSubject,
  inspectDenoLibArtifacts,
  isPreservedDenoLibTest,
  needsDenoLibAssert,
} from "./deno-lib-artifacts.ts";
import {
  checkDisableDenoLib,
  checkEnableDenoLib,
} from "./deno-lib-operations.ts";
import { planDisableDenoLib, planEnableDenoLib } from "./deno-lib-plans.ts";
import { isObject } from "./deno-tasks.ts";

async function detectDenoLib(context: DetectionContext) {
  const config = await inspectDenoConfig(context);
  if (config.kind === "absent") {
    return simple("disabled", "The library export is absent.");
  }
  if (config.kind === "ambiguous") {
    return issue("ambiguous", config.observation);
  }
  const exports = config.value.exports;
  if (
    exports === undefined || (isObject(exports) && exports["."] === undefined)
  ) {
    return simple("disabled", "The library export is absent.");
  }
  if (!isObject(exports)) {
    return issue("ambiguous", "The Deno exports entry is not an object.");
  }
  if (
    exports["."] === denoCliExport ||
    exports["./cli"] !== undefined && exports["."] === exports["./cli"]
  ) {
    return simple(
      "disabled",
      "The default export is the CLI entry point, not a library.",
    );
  }
  if (exports["."] !== denoLibExport) {
    return issue(
      "drifted",
      "The default export differs from the generated library entry point.",
    );
  }
  if (
    await needsDenoLibAssert(context) &&
    (!isObject(config.value.imports) ||
      typeof config.value.imports["@std/assert"] !== "string")
  ) {
    return issue(
      "drifted",
      "The assertion starter needs an @std/assert import.",
    );
  }
  const artifacts = await inspectDenoLibArtifacts(context);
  const invalid = artifacts.find((item) =>
    item.result !== "matches" && !isPreservedDenoLibTest(item)
  );
  if (!invalid) {
    return simple("enabled", "Library export and starter files are adopted.");
  }
  const ambiguous = invalid.result === "unreadable" ||
    (invalid.result === "differs" && invalid.observation.kind !== "file");
  return issue(
    ambiguous ? "ambiguous" : "drifted",
    `Starter file ${invalid.schema.path} does not exactly match.`,
  );
}

function simple(state: "enabled" | "disabled", observation: string) {
  return {
    state,
    evidence: [{
      code: `deno-lib-${state}`,
      kind: "deno-lib",
      subject: denoLibSubject(),
      observation,
    }],
  };
}

function issue(state: "drifted" | "ambiguous", observation: string) {
  const item: DetectionIssue = {
    code: `deno-lib-${state}`,
    kind: "deno-lib",
    subject: denoLibSubject(),
    observation,
    resolution: state === "drifted"
      ? "Use --repair to restore exact contributed content."
      : "Resolve the conflicting path or configuration, then retry.",
  };
  return {
    state,
    evidence: [{
      code: "deno-lib-inspected",
      kind: "deno-lib",
      subject: denoLibSubject(),
      observation,
    }],
    issues: [item],
  };
}

/** Adds a Deno library export and starter files with named assertion steps. */
export const denoLibFeature: Feature = {
  metadata: {
    id: denoLibFeatureId,
    name: "Deno library",
    summary: "Creates a Deno library export and starter files.",
  },
  dependencies: {
    requires: [{
      featureId: "deno-fmt",
      reason: "Deno libraries require Deno formatting.",
    }],
  },
  capabilities: { provides: ["deno-export"], requires: [] },
  detect: detectDenoLib,
  checkEnable: checkEnableDenoLib,
  planEnable: planEnableDenoLib,
  checkDisable: checkDisableDenoLib,
  planDisable: planDisableDenoLib,
};
