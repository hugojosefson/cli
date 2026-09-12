/** @module Shared final planning for mutations and read-only repair previews. */
import type { ChangePlan } from "../api/change-plan.ts";
import type { OperationContext } from "../api/repository-context.ts";
import type { FeatureRegistry } from "../features/feature-registry.ts";
import { reconcileDenoLockPlans } from "../features/deno-lock-policy.ts";
import { reconcileGitIgnorePlans } from "../features/git-ignore-feature.ts";
import { reconcileReadmePlans } from "../features/readme-contribution-plans.ts";

/** Includes shared artifacts which a feature's own planner does not own. */
export async function reconcileFeaturePlans(
  context: OperationContext,
  plans: readonly ChangePlan[],
  registry: FeatureRegistry,
): Promise<readonly ChangePlan[]> {
  if (registry.features.some((feature) => feature.metadata.id === "deno-fmt")) {
    plans = await reconcileDenoLockPlans(context, plans);
  }
  plans = await reconcileReadmePlans(context, plans);
  if (
    registry.features.some((feature) => feature.metadata.id === "git-ignore")
  ) {
    plans = await reconcileGitIgnorePlans(context, plans);
  }
  return plans;
}
