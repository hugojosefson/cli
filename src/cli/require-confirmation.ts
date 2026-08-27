/** @module Confirmation enforcement for plans that require acknowledgement. */

import type { ChangePlan } from "../api/change-plan.ts";

/** Rejects unconfirmed plans before preflight or application. */
export function requireConfirmation(
  plans: readonly ChangePlan[],
  confirmed: boolean,
): void {
  const warning = plans.flatMap((plan) => plan.warnings).find((warning) =>
    warning.requiresConfirmation
  );
  if (warning && !confirmed) {
    throw new Error(
      `confirmation required: ${warning.message} Rerun with \`--yes\`.`,
    );
  }
}
