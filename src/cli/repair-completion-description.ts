/** @module Read-only descriptions of the shared work after applying repair plans. */
import type { ChangePlan } from "../api/change-plan.ts";
import type { OperationContext } from "../api/repository-context.ts";
import { inspectDenoConfig } from "../features/deno-config.ts";
import {
  denoLockPlanOwner,
  readDenoLockOwnership,
} from "../features/deno-lock-policy.ts";
import { isObject } from "../features/deno-tasks.ts";
import { PlannedReadmeFiles } from "../readme/planned-readme-files.ts";

/** No task is run and no lock is generated while inspecting projected files. */
export async function repairCompletionDescription(
  context: OperationContext,
  plans: readonly ChangePlan[],
): Promise<string[]> {
  const changes = plans.flatMap((plan) => plan.changes);
  if (!changes.some((change) => "path" in change)) return [];
  const files = new PlannedReadmeFiles(context.files, changes);
  const config = await inspectDenoConfig({ files });
  const actions: string[] = [];
  if (denoLockPlanOwner(plans)) {
    const ownership = await readDenoLockOwnership(files);
    if (
      ownership?.lock && config.kind === "config" &&
      config.path === ownership.configPath && config.value.lock === true
    ) {
      const lock = await files.observe("deno.lock");
      if (
        lock.kind === "absent" ||
        lock.kind === "file" && lock.digest === ownership.digest
      ) {
        actions.push(
          "Generate or refresh deno.lock from project dependencies and update .hj/deno-lock.json.",
        );
      }
    }
  }
  if (
    config.kind === "config" && isObject(config.value.tasks) &&
    Object.hasOwn(config.value.tasks, "default")
  ) {
    actions.push(
      `Run deno task --config ${config.path} default; this project task can format or generate additional files.`,
    );
  }
  if (
    await context.git.isRepository() ||
    changes.some((change) => change.kind === "git-init")
  ) {
    actions.push(
      "Commit the changed feature files separately in Git after validation.",
    );
  }
  return actions;
}
