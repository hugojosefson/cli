/** @module Detection for Deno formatting configuration. */
import { customFormatIgnores, legacyFormatTasks } from "./deno-fmt-commands.ts";

import {
  formatExclusionError,
  hasCoverageExclusion,
  missingFormatExclusion,
} from "./deno-fmt-exclusions.ts";
import { configuredDenoTask } from "./configured-deno-task.ts";
import { valueDifference } from "./detection-differences.ts";
import type { DetectionIssue } from "../api/feature-detection.ts";
import type { DetectionContext } from "../api/repository-context.ts";
import {
  configuredDenoFmt,
  configuredFormatTasks,
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
  const exclusionError = formatExclusionError(config.value);
  if (exclusionError) {
    return ambiguous(`${config.path}: ${exclusionError}`);
  }
  const tasks = state.tasks!;
  if (tasks.kind === "tasks") {
    const custom = customFormatIgnores(tasks.values);
    if (custom.length > 0) {
      return ambiguous(
        custom.map((name) =>
          `${config.path}: move tasks.${name} --ignore paths to fmt.exclude manually. Automatic command repair is unsupported.`
        ).join("\n"),
      );
    }
    const legacy = legacyFormatTasks(tasks.values);
    if (legacy.length > 0) {
      for (const name of ["fmt", "format"]) {
        if (
          tasks.values[name] !== undefined &&
          !await configuredDenoTask(context, tasks.values, name, "fmt")
        ) {
          return ambiguous(
            `${config.path}: correct tasks.${name} manually before moving formatting exclusions.`,
          );
        }
      }
      const details = legacy.map((name) =>
        `${config.path}: tasks.${name} uses --ignore=coverage, which overrides fmt.exclude.`
      );
      for (const name of ["fmt", "format"]) {
        if (tasks.values[name] === undefined) {
          details.push(
            `${config.path}: tasks.${name} is missing.`,
          );
        }
      }
      if (!hasCoverageExclusion(config.value)) {
        details.push(
          `${config.path}: configuration has no formatting exclusion for coverage.`,
        );
      }
      return drifted(details.join("\n"));
    }
  }
  if (
    tasks.kind === "tasks" && missingFormatExclusion(config.value) &&
    await configuredFormatTasks(context, tasks.values)
  ) {
    return drifted(
      `${config.path}: configuration has no formatting exclusion for coverage.`,
    );
  }
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
    "Apply the listed Deno configuration changes.",
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
