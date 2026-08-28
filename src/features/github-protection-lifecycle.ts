/** @module Guarded lifecycle construction for managed GitHub rulesets. */

import type { ChangePlan } from "../api/change-plan.ts";
import type { Feature } from "../api/feature.ts";
import type {
  AllowedOperation,
  OperationCheck,
} from "../api/feature-operation.ts";
import type {
  DetectionContext,
  OperationContext,
} from "../api/repository-context.ts";
import type { JsonObject } from "../api/json.ts";
import type { PlannedChange } from "../api/planned-change.ts";
import { rulesetResource } from "./github-protection-definitions.ts";
import {
  detected,
  inspectRulesets,
  type RulesetState,
} from "./github-protection-state.ts";
export function rulesetFeature(
  id: string,
  name: string,
  definitions: readonly JsonObject[],
  requires: readonly { featureId: string; reason: string }[],
): Feature {
  const check =
    (enable: boolean) =>
    async (context: OperationContext): Promise<OperationCheck> => {
      const states = await inspectRulesets(context, definitions);
      if (states.some((state) => state.kind === "ambiguous")) {
        return blocked(
          "GitHub rulesets are unavailable or have duplicate reserved names.",
        );
      }
      if (!enable) {
        return states.some((state) => state.kind === "drifted")
          ? blocked("Only exact hj rulesets can be removed.")
          : states.every((state) => state.kind === "absent")
          ? noOp("GitHub protection is absent.")
          : allowed(states);
      }
      if (states.every((state) => state.kind === "exact")) {
        return noOp("GitHub protection is already adopted.");
      }
      if (
        states.some((state) => state.kind === "drifted") &&
        !(context.repair?.kind === "all-drifted" ||
          context.repair?.kind === "features" &&
            context.repair.featureIds.includes(id))
      ) {
        return blocked(
          "A reserved hj ruleset differs. Re-run with --repair to restore it.",
        );
      }
      return allowed(states);
    };
  const plan = (enable: boolean) =>
  async (
    context: OperationContext,
    operation: AllowedOperation,
  ): Promise<ChangePlan> => {
    const states = await inspectRulesets(context, definitions);
    if (states.some((state) => state.kind === "ambiguous")) {
      throw new Error("GitHub ruleset state changed after check");
    }
    const preconditions = rulesetPreconditions(states);
    if (
      JSON.stringify(preconditions) !== JSON.stringify(operation.preconditions)
    ) {
      throw new Error("GitHub ruleset state changed after check");
    }
    const changes: PlannedChange[] = states.flatMap((
      state,
    ): PlannedChange[] =>
      enable
        ? state.kind === "exact" ? [] : [{
          kind: "upsert-github-resource",
          resource: rulesetResource,
          name: state.definition.name as string,
          definition: state.definition,
          expectedStateDigest: state.digest,
        }]
        : state.kind === "exact"
        ? [{
          kind: "delete-github-resource",
          resource: rulesetResource,
          name: state.definition.name as string,
          expectedStateDigest: state.digest!,
        }]
        : []
    );
    return {
      featureId: id,
      action: enable ? "enable" : "disable",
      summary: `${enable ? "Configure" : "Remove"} ${name}.`,
      warnings: operation.warnings,
      preconditions,
      changes,
      validations: [{
        kind: "feature-redetection",
        featureId: id,
        expected: enable ? "enabled" : "disabled",
      }],
    };
  };
  return {
    metadata: { id, name, summary: `Manages ${name}.` },
    dependencies: { requires },
    capabilities: { provides: [], requires: [] },
    detect: async (context: DetectionContext) =>
      detected(await inspectRulesets(context, definitions)),
    checkEnable: check(true),
    planEnable: plan(true),
    checkDisable: check(false),
    planDisable: plan(false),
  };
}
function allowed(states: readonly RulesetState[]): OperationCheck {
  return {
    result: "allowed",
    warnings: [{
      code: "github-ruleset-mutation",
      message:
        "Change GitHub rulesets. Ruleset requests are sequential and may require repair after a partial failure.",
      subjects: [],
      requiresConfirmation: true,
    }],
    preconditions: rulesetPreconditions(states),
  };
}
function rulesetPreconditions(states: readonly RulesetState[]) {
  return states.map((state) => ({
    kind: "github-resource-state" as const,
    resource: rulesetResource,
    name: state.definition.name as string,
    stateDigest: state.digest,
  }));
}
function noOp(reason: string): OperationCheck {
  return { result: "no-op", reason, warnings: [] };
}
function blocked(message: string): OperationCheck {
  return {
    result: "blocked",
    blockers: [{
      code: "github-ruleset-conflict",
      message,
      subjects: [],
      resolution: "Resolve the GitHub ruleset state manually.",
    }],
    warnings: [],
  };
}
