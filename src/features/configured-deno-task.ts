/** Recognize configured Deno tasks without executing project commands. */
import { localModulePath } from "./configured-deno-export.ts";
import type { JsonObject } from "../api/json.ts";
import type { DetectionContext } from "../api/repository-context.ts";
import { isObject } from "./deno-tasks.ts";

/** Accept direct Deno commands, local runner scripts, and task aliases. */
export async function configuredDenoTask(
  context: DetectionContext,
  tasks: JsonObject,
  name: string,
  operation: "fmt" | "lint" | "check" | "test" | "publish",
  canonicalCommand?: string,
  visiting: ReadonlySet<string> = new Set(),
  checkOnly = name === "format" || operation === "publish",
): Promise<boolean> {
  if (visiting.has(name)) return false;
  const next = new Set(visiting).add(name);
  const task = tasks[name];
  const command = typeof task === "string"
    ? task
    : isObject(task)
    ? task.command
    : undefined;
  if (isObject(task) && task.dependencies !== undefined) {
    if (!Array.isArray(task.dependencies) || !task.dependencies.length) {
      return false;
    }
    for (const dependency of task.dependencies) {
      if (
        typeof dependency !== "string" ||
        !await configuredDenoTask(
          context,
          tasks,
          dependency,
          operation,
          canonicalCommand,
          next,
          checkOnly,
        )
      ) return false;
    }
    if (command === undefined) return true;
  }
  if (typeof command !== "string" || !command.trim()) return false;
  if (command === canonicalCommand) return true;
  // Limit recognition to simple commands. Do not infer shell or script behavior.
  if (/[;&|`$<>\n\r]/.test(command)) return false;
  if (
    !/^(?:"[^"\n]*"|'[^'\n]*'|[^\s"'\\]+)(?:\s+(?:"[^"\n]*"|'[^'\n]*'|[^\s"'\\]+))*$/
      .test(command.trim())
  ) return false;
  const tokens =
    command.match(/"[^"\n]*"|'[^'\n]*'|[^\s"']+/g)?.map((token) =>
      token.replace(/^(["'])(.*)\1$/, "$2")
    ) ?? [];
  if (tokens[0] !== "deno") return false;
  if (tokens[1] === "task" && tokens.length === 3) {
    return await configuredDenoTask(
      context,
      tasks,
      tokens[2],
      operation,
      canonicalCommand,
      next,
      checkOnly,
    );
  }
  if (tokens[1] === operation) {
    const separator = tokens.indexOf("--");
    const options = separator < 0
      ? tokens.slice(2)
      : tokens.slice(2, separator);
    if (
      options.some((option) =>
        ["--help", "-h", "--version", "-V"].includes(option)
      )
    ) return false;
    return !checkOnly ||
      options.includes(operation === "publish" ? "--dry-run" : "--check");
  }
  if (tokens[1] !== "run") return false;
  const script = tokens.slice(2).find((token) => !token.startsWith("-"));
  if (!script || !/\.[cm]?[jt]s$/.test(script)) return false;
  const path = localModulePath(
    script.startsWith("./") ? script : `./${script}`,
  );
  if (path === undefined) return false;
  const file = await context.files.observe(path);
  return file.kind === "file" && file.content.trim().length > 0;
}
