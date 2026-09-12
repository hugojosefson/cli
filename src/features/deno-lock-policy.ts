/** @module Shared deno-fmt lock policy and explicit lockfile ownership. */
import { parse } from "jsonc-parser";
import type { ChangePlan } from "../api/change-plan.ts";
import type { PlannedChange } from "../api/planned-change.ts";
import type { OperationContext } from "../api/repository-context.ts";
import { inspectDenoConfig } from "./deno-config.ts";
import { isObject } from "./deno-tasks.ts";

import {
  type DenoLockOwnership,
  denoLockOwnershipPath,
  denoLockOwnershipText,
  denoLockPath,
  readDenoLockOwnership,
} from "./deno-lock-ownership.ts";
export {
  denoLockOwnershipPath,
  denoLockOwnershipText,
  denoLockPath,
  readDenoLockOwnership,
} from "./deno-lock-ownership.ts";
const contributors = ["deno-cli", "deno-server"];

/** The final application contribution owns shared lock changes, with fmt as fallback. */
export function denoLockPlanOwner(
  plans: readonly ChangePlan[],
): ChangePlan | undefined {
  return plans.findLast((plan) => contributors.includes(plan.featureId)) ??
    plans.findLast((plan) => plan.featureId === "deno-fmt");
}

/** Attach shared policy changes to the application feature responsible for them. */
export async function reconcileDenoLockPlans(
  context: OperationContext,
  plans: readonly ChangePlan[],
): Promise<readonly ChangePlan[]> {
  const owner = denoLockPlanOwner(plans);
  if (!owner) return plans;
  const config = await inspectDenoConfig(context);
  if (config.kind === "ambiguous") return plans;
  const creation = plans.flatMap((plan) => plan.changes).find((change) =>
    change.kind === "write-file" &&
    ["deno.json", "deno.jsonc"].includes(change.path)
  );
  const path = config.kind === "config"
    ? config.path
    : creation && "path" in creation
    ? creation.path
    : undefined;
  if (!path) return plans;
  // An explicitly removed standalone config needs no remaining lock policy.
  const removed = plans.some((plan) =>
    plan.changes.some((change) =>
      change.kind === "remove-file" && change.path === path
    )
  );
  const value = config.kind === "config"
    ? config.value
    : parse(creation!.kind === "write-file" ? creation!.content : "{}");
  const prior = await readDenoLockOwnership(context.files);
  const record = await context.files.observe(denoLockOwnershipPath);
  if (record.kind !== "file" && record.kind !== "absent") {
    throw new Error(`${denoLockOwnershipPath} must be a regular file.`);
  }
  if (record.kind === "file" && !prior) {
    throw new Error(
      `Resolve the unrecognized ${denoLockOwnershipPath} before changing lock policy.`,
    );
  }
  const managed = prior?.configPath === path && prior.lock === value.lock;
  // Custom paths/options remain outside managed lockfile ownership.
  if (
    !removed &&
    (typeof value.lock === "string" || isObject(value.lock))
  ) return plans;
  const required = contributors.some((id) =>
    context.resolvedChanges.find((change) => change.featureId === id)
      ?.enabled ??
      (["enabled", "drifted"].includes(
        context.detections.get(id)?.state ?? "disabled",
      ))
  );
  const explicit = value.lock === true &&
    (!managed || prior?.explicit === true);
  const retiring = removed ||
    plans.some((plan) =>
        plan.featureId === "deno-fmt" && plan.action === "disable"
      ) && !required;
  const desired = !removed && (required || explicit);
  const lock = await context.files.observe(denoLockPath);
  const ownsFile = lock.kind === "file" && prior?.digest === lock.digest;
  const changes: PlannedChange[] = [];
  if (retiring && !removed && managed && !explicit) {
    changes.push({
      kind: "remove-json",
      path,
      jsonPath: ["lock"],
      expected: value.lock,
    });
  } else if (!retiring && value.lock !== desired) {
    changes.push({
      kind: "set-json",
      path,
      jsonPath: ["lock"],
      value: desired,
      expected: value.lock,
    });
  }
  if (!desired && ownsFile) {
    changes.push({
      kind: "remove-file",
      path: denoLockPath,
      expectedDigest: lock.digest,
    });
  }
  if (retiring) {
    if (record.kind === "file") {
      changes.push({
        kind: "remove-file",
        path: denoLockOwnershipPath,
        expectedDigest: record.digest,
      });
    }
  } else {
    const state: DenoLockOwnership = {
      version: 1,
      configPath: path,
      lock: desired,
      ...(explicit ? { explicit: true as const } : {}),
      ...(desired && ownsFile ? { digest: lock.digest } : {}),
    };
    const content = denoLockOwnershipText(state);
    if (record.kind !== "file" || record.content !== content) {
      if ((await context.files.observe(".hj")).kind === "absent") {
        changes.push({ kind: "create-directory", path: ".hj" });
      }
      changes.push({
        kind: "write-file",
        path: denoLockOwnershipPath,
        content,
        expectedDigest: record.kind === "file" ? record.digest : undefined,
      });
    }
  }
  return plans.map((plan) =>
    plan === owner ? { ...plan, changes: [...plan.changes, ...changes] } : plan
  );
}
