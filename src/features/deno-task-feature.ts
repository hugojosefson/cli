/** @module Factory for independent Deno task features. */

import type { Feature } from "../api/feature.ts";
import { inspectDenoTask, taskDetection } from "./deno-task-inspection.ts";
import { checkDenoTask, planDenoTask } from "./deno-task-plans.ts";
import { leafTaskNames, type TaskFeatureId } from "./deno-tasks.ts";

/** Creates a leaf task feature with shared inspection and aggregate ownership. */
export function denoTaskFeature(id: TaskFeatureId, name: string): Feature {
  const task = leafTaskNames[id];
  return {
    metadata: {
      id,
      name,
      summary: `Adds the Deno ${task} task without requiring Git.`,
    },
    dependencies: {
      requires: [{
        featureId: "deno-fmt",
        reason: "Deno tasks require formatting tasks.",
      }],
    },
    capabilities: { provides: [], requires: [] },
    detect: async (context) => {
      const state = await inspectDenoTask(context, id);
      if (state.kind === "ambiguous") {
        return taskDetection("ambiguous", id, state.message);
      }
      if (!state.exact && !state.present) {
        return taskDetection("disabled", id, `Deno task ${task} is absent.`);
      }
      if (!state.exact) {
        return taskDetection("drifted", id, `Deno task ${task} differs.`);
      }
      return state.aggregate
        ? taskDetection("enabled", id, `Deno task ${task} is adopted.`)
        : taskDetection(
          "drifted",
          id,
          `Deno task ${task} or the check aggregate differs.`,
        );
    },
    checkEnable: (context) => checkDenoTask(context, id, true),
    planEnable: (context, allowed) => planDenoTask(context, allowed, id, true),
    checkDisable: (context) => checkDenoTask(context, id, false),
    planDisable: (context, allowed) =>
      planDenoTask(context, allowed, id, false),
  };
}
