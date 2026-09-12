/** @module Exact-state inspection for managed GitHub rulesets. */

import type {
  DetectionContext,
  GithubResource,
} from "../api/repository-context.ts";
import type { JsonObject } from "../api/json.ts";
import { canonical } from "../repository/canonical-ruleset.ts";
import { rulesetResource } from "./github-protection-definitions.ts";
import {
  githubAccessResolution,
  unavailableGithubRepository,
} from "./github-repository-access.ts";
export type RulesetState = {
  readonly definition: JsonObject;
  readonly digest?: string;
  readonly kind: "absent" | "exact" | "drifted" | "ambiguous";
};
export async function inspectRulesets(
  context: DetectionContext,
  definitions: readonly JsonObject[],
): Promise<readonly RulesetState[]> {
  if (!context.github || !await context.github.repository()) {
    const unavailable = await unavailableGithubRepository(context);
    return definitions.map((definition) => ({
      definition,
      kind: unavailable.state === "disabled" ? "absent" : "ambiguous",
    }));
  }
  const rulesets = await context.github.rulesets();
  if (!rulesets) {
    return definitions.map((definition) => ({ definition, kind: "ambiguous" }));
  }
  return definitions.map((definition) => classify(rulesets, definition));
}
function classify(
  rulesets: readonly GithubResource[],
  expected: JsonObject,
): RulesetState {
  const matches = rulesets.filter((item) =>
    item.kind === rulesetResource && item.name === expected.name
  );
  if (!matches.length) return { definition: expected, kind: "absent" };
  if (matches.length !== 1) return { definition: expected, kind: "ambiguous" };
  if (
    matches[0].sourceType !== "Repository"
  ) {
    return { definition: expected, kind: "ambiguous" };
  }
  const { id: _id, ...actual } = matches[0].definition;
  return {
    definition: expected,
    digest: matches[0].stateDigest,
    kind: JSON.stringify(canonical(actual)) === JSON.stringify(expected)
      ? "exact"
      : "drifted",
  };
}
export function detected(states: readonly RulesetState[]) {
  const evidence = states.map((state) => ({
    code: "github-ruleset-inspected",
    kind: "github-ruleset",
    subject: {
      kind: "github-ruleset",
      identifier: String(state.definition.name),
    },
    observation: `${state.definition.name}: ${
      state.kind === "exact"
        ? "managed protection is active"
        : state.kind === "absent"
        ? "managed protection is absent"
        : state.kind === "drifted"
        ? "managed protection differs"
        : "protection could not be confirmed"
    }.`,
  }));
  const issues = evidence.filter((_, index) =>
    !["exact", "absent"].includes(states[index].kind)
  ).map((item) => ({
    ...item,
    resolution: githubAccessResolution +
      " Inspect the named GitHub rulesets before changing protection.",
  }));
  if (states.some((state) => state.kind === "ambiguous")) {
    return { state: "ambiguous" as const, evidence, issues };
  }
  if (states.every((state) => state.kind === "absent")) {
    return { state: "disabled" as const, evidence };
  }
  return states.every((state) => state.kind === "exact")
    ? { state: "enabled" as const, evidence }
    : { state: "drifted" as const, evidence, issues };
}
