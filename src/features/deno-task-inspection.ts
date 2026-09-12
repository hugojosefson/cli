/** @module Inspection and detection for independent Deno tasks. */

import { denoTestTasks, hasServer } from "./deno-test-tasks.ts";
import { configuredDenoTask } from "./configured-deno-task.ts";
import type { DetectionContext } from "../api/repository-context.ts";
import { sameJson } from "../operations/local-plan-state.ts";
import { inspectDenoConfig } from "./deno-config.ts";
import { denoFmtSubject } from "./deno-fmt-inspection.ts";
import {
  denoTaskDefinitions,
  isObject,
  isReadmeTask,
  leafTaskDefinitions,
  leafTaskNames,
  presentPublishCheck,
  presentTaskIds,
  type TaskFeatureId,
} from "./deno-tasks.ts";

export async function inspectDenoTask(
  context: DetectionContext,
  id: TaskFeatureId,
) {
  const config = await inspectDenoConfig(context);
  if (config.kind !== "config") {
    return config.kind === "ambiguous"
      ? { kind: "ambiguous" as const, message: config.observation }
      : { kind: "absent" as const, exact: false, aggregate: false };
  }
  const tasks = config.value.tasks;
  if (tasks === undefined) {
    return {
      kind: "absent" as const,
      exact: false,
      present: false,
      aggregate: false,
    };
  }
  if (!isObject(tasks)) {
    return {
      kind: "ambiguous" as const,
      message: "The Deno tasks entry is not an object.",
    };
  }
  const actual = tasks[leafTaskNames[id]];
  if (actual !== undefined && typeof actual !== "string" && !isObject(actual)) {
    return {
      kind: "ambiguous" as const,
      message: `Deno task ${leafTaskNames[id]} is not an object.`,
    };
  }
  const exact = sameJson(actual, leafTaskDefinitions[id]);
  const legacyTest = id === "deno-test" && sameJson(actual, {
    description: "Run tests.",
    command: "deno test --parallel --trace-leaks",
  });
  const auxiliary = id !== "deno-test" ||
    Object.entries(denoTestTasks(tasks, hasServer(config.value))).every((
      [name, definition],
    ) => sameJson(tasks[name], definition));
  return {
    kind: "tasks" as const,
    auxiliary,
    config,
    tasks,
    present: actual !== undefined,
    configured: !legacyTest && (!exact || auxiliary) &&
      await configuredDenoTask(
        context,
        tasks,
        leafTaskNames[id],
        id === "deno-typecheck"
          ? "check"
          : id === "deno-lint"
          ? "lint"
          : "test",
        leafTaskDefinitions[id].command as string,
      ),
    exact,
    aggregate: sameJson(
      tasks.check,
      denoTaskDefinitions(
        presentTaskIds(tasks),
        isReadmeTask(tasks.readme),
        presentPublishCheck(tasks),
      ).check,
    ),
  };
}

export function taskDetection(
  state: "disabled" | "enabled" | "drifted" | "ambiguous",
  id: string,
  observation: string,
) {
  const subject = denoFmtSubject();
  if (state === "disabled" || state === "enabled") {
    return {
      state,
      evidence: [{ code: `${id}-${state}`, kind: id, subject, observation }],
    };
  }
  return {
    state,
    evidence: [{ code: `${id}-inspected`, kind: id, subject, observation }],
    issues: [{
      code: `${id}-${state}`,
      kind: id,
      subject,
      observation,
      resolution: "Resolve the conflict or use --repair.",
    }],
  };
}
