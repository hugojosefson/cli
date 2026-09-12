/** @module Run the resulting project's default task before feature commits. */
import { runCommand } from "../runtime/command.ts";

import type { ChangePlan } from "../api/change-plan.ts";
import { inspectDenoConfig } from "../features/deno-config.ts";
import { isObject } from "../features/deno-tasks.ts";
import { LocalFileReader } from "../repository/local-file-reader.ts";
import { repositoryRoot } from "../repository/repository-path.ts";
import { CommandFailure } from "./command-failure.ts";

/** Conservatively treats every local file change as a possible task input. */
export async function runFinalProjectTask(
  root: URL,
  plans: readonly ChangePlan[],
): Promise<string | undefined> {
  if (!plans.some((plan) => plan.changes.some((change) => "path" in change))) {
    return undefined;
  }
  const config = await inspectDenoConfig({ files: new LocalFileReader(root) });
  if (config.kind === "ambiguous") {
    throw new Error(
      `Cannot determine the final project task: ${config.observation}\n` +
        "Changes remain visible; no feature-content commits were created.",
    );
  }
  if (
    config.kind === "absent" || !isObject(config.value.tasks) ||
    !Object.hasOwn(config.value.tasks, "default")
  ) {
    return "No final default task remains.";
  }
  const result = await runCommand("deno", {
    args: ["task", "--config", config.path, "default"],
    cwd: repositoryRoot(root).path,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const status = result;
  if (!status.success) {
    throw new CommandFailure(
      `deno task default failed (exit ${status.code}).\n` +
        "Changes remain visible; no feature-content commits were created.",
      status.code,
    );
  }
  return "deno task default passed.";
}
