import { assertThrows } from "@std/assert";
import type { ChangePlan } from "../api/change-plan.ts";
import { requireConfirmation } from "./require-confirmation.ts";

const plans: readonly ChangePlan[] = [{
  featureId: "test",
  action: "enable",
  summary: "test",
  warnings: [{
    code: "test-warning",
    message: "Synthetic confirmation warning.",
    subjects: [],
    requiresConfirmation: true,
  }],
  preconditions: [],
  changes: [],
  validations: [],
}];

Deno.test("requires confirmation for the first flagged warning", () => {
  assertThrows(
    () => requireConfirmation(plans, false),
    Error,
    "confirmation required: Synthetic confirmation warning. Rerun with `--yes`.",
  );
  requireConfirmation(plans, true);
});
