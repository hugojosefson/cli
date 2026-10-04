/** @module Built-in Deno library feature declaration and detection. */

import {
  artifactDifference,
  fileDifference,
  modulePathDifference,
  valueDifference,
} from "./detection-differences.ts";
import { localModulePath } from "./configured-deno-export.ts";
import { isDenoLibCliExport } from "./deno-lib-export.ts";
import type { DetectionIssue } from "../api/feature-detection.ts";
import type { DetectionContext } from "../api/repository-context.ts";
import type { Feature } from "../api/feature.ts";
import { inspectDenoConfig } from "./deno-config.ts";
import {
  denoLibArtifacts,
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
    return issue(
      "ambiguous",
      valueDifference(
        config.path,
        "exports",
        "an object",
        config.value.exports,
      ),
    );
  }
  if (isDenoLibCliExport(exports)) {
    return simple(
      "disabled",
      "The default export is the CLI entry point, not a library.",
    );
  }
  const path = localModulePath(exports["."]);
  if (path === undefined) {
    return issue(
      "ambiguous",
      modulePathDifference(config.path, exports["."], "."),
    );
  }
  const file = await context.files.observe(path);
  if (file.kind !== "file" || file.content.trim().length === 0) {
    return issue(
      file.kind === "file" || file.kind === "absent" ? "drifted" : "ambiguous",
      file.kind === "file"
        ? `${path}: expected a nonempty library entry point. Found an empty file.`
        : fileDifference(path, file),
      file.kind === "absent" && exports["."] === denoLibExport
        ? `Repair adds ${path} with the placeholder export.`
        : `Automatic repair cannot replace library source. Supply a readable, nonempty library file at ${path}.`,
    );
  }
  if (
    exports["."] !== denoLibExport ||
    file.content !== denoLibArtifacts[0].content
  ) {
    return simple(
      "enabled",
      `The default export points to the local library file ${path}.`,
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
    item.schema.path === "test/lib_test.ts" &&
    item.result !== "matches" && !isPreservedDenoLibTest(item)
  );
  if (!invalid) {
    return simple("enabled", "Library export and starter files are adopted.");
  }
  const ambiguous = invalid.result === "unreadable" ||
    (invalid.result === "differs" && invalid.observation.kind !== "file");
  return issue(
    ambiguous ? "ambiguous" : "drifted",
    artifactDifference(invalid),
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

function issue(
  state: "drifted" | "ambiguous",
  observation: string,
  resolution =
    "Correct the named configuration entry or file. Preserve custom source files.",
) {
  const item: DetectionIssue = {
    code: `deno-lib-${state}`,
    kind: "deno-lib",
    subject: denoLibSubject(),
    observation,
    resolution,
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
