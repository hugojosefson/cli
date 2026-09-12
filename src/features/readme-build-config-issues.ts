/** @module Deno configuration findings for README builds. */

import type { DetectionIssue } from "../api/feature-detection.ts";
import type { DetectionContext } from "../api/repository-context.ts";
import { denoTaskDefinitions, isObject } from "./deno-tasks.ts";
import { readmeBuildIssue as issue } from "./readme-build-issue.ts";
import type { inspectReadmeBuild } from "./readme-build-state.ts";

export async function readmeBuildConfigIssues(
  state: Awaited<ReturnType<typeof inspectReadmeBuild>>,
  context: DetectionContext,
): Promise<DetectionIssue[]> {
  const issues: DetectionIssue[] = [];
  if (state.config.kind === "absent") {
    const custom = await packageReadmeScript(context);
    issues.push(
      issue(
        "deno.json",
        "deno.json and deno.jsonc are missing. readme-build requires Deno tasks." +
          (custom
            ? " package.json defines scripts.readme for a custom README builder."
            : ""),
        custom
          ? "Automatic migration from package.json scripts.readme is unavailable. Keep the custom builder, or manually migrate it to Deno tasks.readme and tasks.default."
          : "Make one Deno configuration with tasks.readme and tasks.default before adopting readme-build.",
      ),
    );
  } else if (state.config.kind === "ambiguous") {
    issues.push(
      issue(
        "deno.json",
        state.config.observation,
        "Keep one readable Deno configuration: deno.json or deno.jsonc. Use a JSON object with a tasks object.",
      ),
    );
  } else if (!isObject(state.tasksValue ?? null)) {
    issues.push(
      issue(
        state.config.path,
        `tasks has type ${
          valueType(state.tasksValue)
        }. readme-build requires an object.`,
        "Make tasks an object with readme and default entries. Preserve custom commands.",
      ),
    );
  } else {
    for (
      const [name, usable, value] of [
        ["readme", state.taskUsable, state.taskValue],
        ["default", state.defaultUsable, state.defaultValue],
      ] as const
    ) {
      if (usable) {
        continue;
      }
      issues.push(
        issue(
          state.config.path,
          `tasks.${name} has type ${
            valueType(value)
          }. readme-build requires a task object.`,
          `Manually change tasks.${name} to an object. The managed definition is ${
            JSON.stringify(denoTaskDefinitions(state.taskIds, true)[name])
          }. Preserve custom commands before conversion.`,
        ),
      );
    }
  }
  return issues;
}

function valueType(value: unknown): string {
  return value === undefined
    ? "absent"
    : value === null
    ? "null"
    : Array.isArray(value)
    ? "array"
    : typeof value;
}

async function packageReadmeScript(
  context: DetectionContext,
): Promise<boolean> {
  const file = await context.files.observe("package.json");
  if (file.kind !== "file") {
    return false;
  }
  try {
    const value = JSON.parse(file.content);
    return typeof value?.scripts?.readme === "string";
  } catch {
    return false;
  }
}
