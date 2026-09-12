/** @module Detection for Deno formatting configuration. */

import { valueDifference } from "./detection-differences.ts";
import type { DetectionIssue } from "../api/feature-detection.ts";
import type { DetectionContext } from "../api/repository-context.ts";
import {
  configuredDenoFmt,
  denoFmtSubject,
  inspectDenoFmt,
} from "./deno-fmt-inspection.ts";
import { denoTaskNames } from "./deno-tasks.ts";

/** Detects absent, adopted, drifted, and ambiguous Deno formatting tasks. */
export async function detectDenoFmt(context: DetectionContext) {
  const state = await inspectDenoFmt(context);
  if (await configuredDenoFmt(context, state)) {
    return simple(
      "enabled",
      "Deno formatting tasks are configured.",
    );
  }
  if (state.config.kind === "absent") {
    return simple("disabled", "Deno configuration is absent.");
  }
  if (state.config.kind === "ambiguous") {
    return ambiguous(state.config.observation);
  }
  const config = state.config;
  const tasks = state.tasks!;
  if (tasks.kind === "missing-tasks") {
    return simple("disabled", "Deno tasks are absent.");
  }
  if (tasks.kind === "ambiguous-tasks") {
    return ambiguous(
      valueDifference(
        config.path,
        "tasks",
        "an object",
        config.value.tasks,
      ),
    );
  }
  if (tasks.ambiguous.length > 0) {
    return ambiguous(
      tasks.ambiguous.map((name) =>
        valueDifference(
          config.path,
          `tasks.${name}`,
          "a task object",
          tasks.values[name],
        )
      ).join("\n"),
    );
  }
  if (tasks.missing.length === denoTaskNames.length) {
    return simple("disabled", "Contributed Deno tasks are absent.");
  }
  if (tasks.missing.length > 0 || tasks.drifted.length > 0) {
    return drifted("One or more contributed Deno tasks are missing or differ.");
  }
  return simple("enabled", "Required Deno formatting tasks are adopted.");
}

function simple(state: "disabled" | "enabled", observation: string) {
  return {
    state,
    evidence: [{
      code: `deno-fmt-${state}`,
      kind: "deno-fmt",
      subject: denoFmtSubject(),
      observation,
    }],
  };
}

function drifted(observation: string) {
  return issueDetection(
    "drifted",
    "deno-fmt-drifted",
    observation,
    "Use --repair to restore contributed task definitions.",
  );
}

function ambiguous(observation: string) {
  return issueDetection(
    "ambiguous",
    "deno-fmt-ambiguous",
    observation,
    "Correct the named Deno configuration entry. Preserve custom task commands.",
  );
}

function issueDetection(
  state: "drifted" | "ambiguous",
  code: string,
  observation: string,
  resolution: string,
) {
  const subject = denoFmtSubject();
  const issue: DetectionIssue = {
    code,
    kind: "deno-fmt",
    subject,
    observation,
    resolution,
  };
  return {
    state,
    evidence: [{
      code: "deno-fmt-inspected",
      kind: "deno-fmt",
      subject,
      observation,
    }],
    issues: [issue],
  };
}
