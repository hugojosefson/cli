/** Task contributions owned by the Deno server feature. */
import type { JsonObject } from "../api/json.ts";
import { sameJson } from "../operations/local-plan-state.ts";
import { isObject } from "./deno-tasks.ts";

export const denoServerTasks: Readonly<Record<string, JsonObject>> = {
  serve: {
    description: "Start the HTTP server.",
    command: "deno serve ./src/server/server.ts",
  },
  dev: {
    description: "Restart the HTTP server when source files change.",
    command: "deno serve --watch ./src/server/server.ts",
  },
};

/** Keep absent tasks distinct from custom tasks before planning writes. */
export function inspectDenoServerTasks(config: JsonObject) {
  const tasks = config.tasks;
  if (tasks !== undefined && !isObject(tasks)) {
    return { kind: "ambiguous" as const, missing: [], different: [] };
  }
  const missing: string[] = [];
  const different: string[] = [];
  for (const [name, definition] of Object.entries(denoServerTasks)) {
    if (tasks?.[name] === undefined) missing.push(name);
    else if (!sameJson(tasks[name], definition)) different.push(name);
  }
  return { kind: "tasks" as const, missing, different };
}
