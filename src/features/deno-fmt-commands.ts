/** @module Safe migration of previous formatting commands. */
import type { JsonObject } from "../api/json.ts";
import type { PlannedChange } from "../api/planned-change.ts";
import { isObject } from "./deno-tasks.ts";

const commands: Readonly<Record<string, string>> = {
  fmt: "deno fmt",
  format: "deno fmt --check",
};

/** Recognize complete commands without changing custom shell behavior. */
export function legacyFormatTasks(tasks: JsonObject): string[] {
  return Object.entries(commands).filter(([name, command]) => {
    const task = tasks[name];
    return (typeof task === "string"
      ? task
      : isObject(task)
      ? task.command
      : undefined) ===
      `${command} --ignore=coverage`;
  }).map(([name]) => name);
}

export function legacyFormatChanges(
  path: string,
  tasks: JsonObject,
): PlannedChange[] {
  return legacyFormatTasks(tasks).map((name) => {
    const task = tasks[name];
    return typeof task === "string"
      ? {
        kind: "set-json",
        path,
        jsonPath: ["tasks", name],
        value: commands[name],
        expected: task,
      }
      : {
        kind: "set-json",
        path,
        jsonPath: ["tasks", name, "command"],
        value: commands[name],
        expected: (task as JsonObject).command,
      };
  });
}

/** Custom ignore arguments have no automatic command replacement. */
export function customFormatIgnores(tasks: JsonObject): string[] {
  const legacy = legacyFormatTasks(tasks);
  return ["fmt", "format"].filter((name) => {
    const task = tasks[name];
    const command = typeof task === "string"
      ? task
      : isObject(task)
      ? task.command
      : undefined;
    return !legacy.includes(name) && typeof command === "string" &&
      /(?:^|\s)--ignore(?:=|\s|$)/.test(command);
  });
}
