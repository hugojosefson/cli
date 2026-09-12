/** Additional test tasks and shared development-task ownership. */
import type { JsonObject } from "../api/json.ts";
import type { PlannedChange } from "../api/planned-change.ts";
import type { OperationContext } from "../api/repository-context.ts";
import { sameJson } from "../operations/local-plan-state.ts";
import { isObject, leafTaskDefinitions } from "./deno-tasks.ts";

export const coverageTaskDefinition: JsonObject = {
  description: "Run tests and report fresh coverage.",
  command: "deno task test",
};

export const testWatchTaskDefinition: JsonObject = {
  description: "Run tests when source files change.",
  command: "deno test --parallel --trace-leaks --watch",
};

/** Preserve a server or custom development task and name test watching separately. */
export function denoTestTasks(tasks: JsonObject, server: boolean): JsonObject {
  const watchName = server ||
      tasks.dev !== undefined && !sameJson(tasks.dev, testWatchTaskDefinition)
    ? "dev:test"
    : "dev";
  return {
    coverage: coverageTaskDefinition,
    [watchName]: testWatchTaskDefinition,
  };
}

export function hasServer(config: JsonObject): boolean {
  return isObject(config.exports) &&
    config.exports["./server"] === "./src/server/server.ts";
}

/** Compute auxiliary task changes from the operation's original snapshot. */
export function testTaskTransition(
  context: OperationContext,
  config: JsonObject,
  owner: "deno-test" | "deno-server",
  enable: boolean,
) {
  const tasks = isObject(config.tasks) ? config.tasks : {};
  const testEnabled = owner === "deno-test"
    ? enable
    : context.resolvedChanges.find((change) => change.featureId === "deno-test")
      ?.enabled ?? sameJson(tasks.test, leafTaskDefinitions["deno-test"]);
  const serverChange = context.resolvedChanges.find((change) =>
    change.featureId === "deno-server"
  );
  const serverEnabled = owner === "deno-server"
    ? enable
    : serverChange?.enabled ?? hasServer(config);
  const removingServer =
    (owner === "deno-server" || serverChange !== undefined) && !serverEnabled &&
    hasServer(config);
  const available = { ...tasks };
  if (removingServer) delete available.dev;
  const desired = testEnabled ? denoTestTasks(available, serverEnabled) : {};
  const conflicts = Object.entries(desired).filter(([name, definition]) =>
    available[name] !== undefined && !sameJson(available[name], definition)
  ).map(([name]) => name);
  return { tasks, desired, removingServer, serverEnabled, conflicts };
}

/** Plan auxiliary tasks once when test and server features share an operation. */
export function planTestTasks(
  context: OperationContext,
  config: JsonObject,
  path: string,
  owner: "deno-test" | "deno-server",
  enable: boolean,
): PlannedChange[] {
  if (
    owner === "deno-test" &&
    context.resolvedChanges.some((change) =>
      change.featureId === "deno-server" &&
      (change.enabled || hasServer(config))
    )
  ) return [];
  if (!isObject(config.tasks)) return [];
  const { tasks, desired, removingServer, serverEnabled } = testTaskTransition(
    context,
    config,
    owner,
    enable,
  );
  const changes: PlannedChange[] = [];
  for (const [name, definition] of Object.entries(desired)) {
    if (sameJson(tasks[name], definition)) continue;
    changes.push({
      kind: "set-json",
      path,
      jsonPath: ["tasks", name],
      value: definition,
      expected: name === "dev" && removingServer ? undefined : tasks[name],
    });
  }
  for (const name of ["coverage", "dev", "dev:test"]) {
    if (desired[name] !== undefined) continue;
    if (name === "dev" && serverEnabled) continue;
    const definition = name === "coverage"
      ? coverageTaskDefinition
      : testWatchTaskDefinition;
    if (sameJson(tasks[name], definition)) {
      changes.push({
        kind: "remove-json",
        path,
        jsonPath: ["tasks", name],
        expected: definition,
      });
    }
  }
  return changes;
}
