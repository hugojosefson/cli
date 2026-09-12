/** @module Built-in Deno server feature declaration and detection. */

import {
  artifactDifference,
  valueDifference,
} from "./detection-differences.ts";
import { inspectDenoServerTasks } from "./deno-server-tasks.ts";
import {
  denoCliExport,
  denoCliServerPaths,
  inspectDenoCliArtifacts,
} from "./deno-cli-artifacts.ts";
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
      : issue(
        "ambiguous",
        valueDifference(
          config.path,
          "exports",
          "an object",
          config.value.exports,
        ),
      );
  }
  if (config.value.exports["./server"] === undefined) {
    return simple("disabled", "The managed ./server export is absent.");
  }
  if (config.value.exports["./server"] !== denoServerExport) {
    return issue("drifted", "The server export differs.");
  }
  const tasks = inspectDenoServerTasks(config.value);
  if (tasks.kind === "ambiguous") {
    return issue(
      "ambiguous",
      valueDifference(config.path, "tasks", "an object", config.value.tasks),
    );
  }
  if (tasks.missing.length || tasks.different.length) {
    return issue(
      "drifted",
      `Server task ${
        [...tasks.missing, ...tasks.different][0]
      } is missing or differs.`,
    );
  }
  const artifacts = [...await inspectDenoServerArtifacts(context)];
  if (config.value.exports["./cli"] === denoCliExport) {
    artifacts.push(
      ...(await inspectDenoCliArtifacts(context, true)).filter((item) =>
        denoCliServerPaths.includes(item.schema.path)
      ),
    );
  }
  const invalid = artifacts.find((item) => item.result !== "matches");
  if (!invalid) {
    return simple(
      "enabled",
      "Server export, serve/dev tasks, and starter files are adopted.",
    );
  }
  const ambiguous = invalid.result === "unreadable" ||
    invalid.result === "differs" && invalid.observation.kind !== "file";
  return issue(
    ambiguous ? "ambiguous" : "drifted",
    artifactDifference(invalid),
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
      : "Correct the named configuration entry or file type. Preserve custom source files.",
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
    summary: "Creates an HTTP server with serve and dev tasks.",
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
