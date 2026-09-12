/** @module Next steps after successful feature changes. */
import type { ChangePlan } from "../api/change-plan.ts";

export function featureRecommendations(plans: readonly ChangePlan[]): string {
  return plans.some((plan) =>
      plan.featureId === "github-default-project" && plan.action === "enable" &&
      plan.changes.some((change) => change.kind === "upsert-github-resource")
    )
    ? "To add future GitHub issues to the default project, run `hj repo project-auto-add --yes` with a signed-in Firefox automation session. " +
      "Browser setup and fallback instructions: https://github.com/hugojosefson/cli/blob/main/docs/repository-features.md#default-github-project."
    : "";
}
