/** @module Remote GitHub plan verifier and applicator. */
import type { ChangePlan } from "../api/change-plan.ts";
import type {
  GithubResourceDelete,
  GithubResourceUpsert,
  GithubWriter,
} from "../api/repository-context.ts";
import type {
  GithubRulesetExpectation,
  GithubRulesetTransitionChange,
} from "../api/planned-change.ts";
import { canonical } from "../repository/canonical-ruleset.ts";

export async function preflightGithubChangePlan(
  github: GithubWriter,
  plan: ChangePlan,
): Promise<void> {
  await verifyRemoteFilePreconditions(github, plan.preconditions);
  const preconditions = new Map<string, string | undefined>();
  for (const condition of plan.preconditions) {
    if (condition.kind !== "github-resource-state") continue;
    const key = resourceKey(condition.resource, condition.name);
    if (preconditions.has(key)) {
      throw new Error("contradictory GitHub resource");
    }
    preconditions.set(key, condition.stateDigest);
  }
  for (const change of plan.changes) {
    if (change.kind === "github-ruleset-transition") {
      verifyTransition(change);
      continue;
    }
    if (
      change.kind === "upsert-github-resource" &&
      change.resource !== "repository-setting" &&
      change.resource !== "repository-ruleset"
    ) {
      throw new Error("unsupported GitHub resource");
    }
    if (
      (change.kind === "delete-github-resource" &&
        change.resource !== "repository-ruleset") || change.kind === "app-setup"
    ) {
      throw new Error("unsupported GitHub operation");
    }
    if (
      change.kind === "upsert-github-resource" ||
      change.kind === "delete-github-resource"
    ) {
      const key = resourceKey(change.resource, change.name);
      if (
        !preconditions.has(key) ||
        preconditions.get(key) !== change.expectedStateDigest
      ) throw new Error("GitHub resource precondition failed");
    }
  }
  for (const condition of plan.preconditions) {
    if (condition.kind !== "github-resource-state") continue;
    const resource = await github.resource(condition.resource, condition.name);
    if (resource?.stateDigest !== condition.stateDigest) {
      throw new Error("GitHub resource precondition failed");
    }
  }
}
export async function applyGithubChangePlans(
  github: GithubWriter,
  plans: readonly ChangePlan[],
): Promise<void> {
  await verifyRemoteFilePreconditions(
    github,
    plans.flatMap((plan) => plan.preconditions),
  );
  const resources: GithubResourceUpsert[] = [];
  const deletes: GithubResourceDelete[] = [];
  const transitions: GithubRulesetTransitionChange[] = [];
  for (const plan of plans) {
    for (const change of plan.changes) {
      if (change.kind === "github-ruleset-transition") {
        verifyTransition(change);
        transitions.push(change);
        continue;
      }
      if (change.kind === "delete-github-resource") {
        if (change.resource !== "repository-ruleset") {
          throw new Error("unsupported GitHub resource");
        }
        deletes.push({
          resource: change.resource,
          name: change.name,
          expectedStateDigest: change.expectedStateDigest,
        });
        continue;
      }
      if (change.kind !== "upsert-github-resource") continue;
      if (
        change.resource !== "repository-setting" &&
        change.resource !== "repository-ruleset"
      ) {
        throw new Error("unsupported GitHub resource");
      }
      if (
        change.resource === "repository-setting" &&
        change.expectedStateDigest === undefined
      ) {
        throw new Error("GitHub resource precondition failed");
      }
      resources.push({
        resource: change.resource,
        name: change.name,
        definition: change.definition,
        expectedStateDigest: change.expectedStateDigest,
      });
    }
  }
  rejectContradictoryResources(resources);
  if (transitions.length > 1) {
    throw new Error("incompatible GitHub ruleset transition");
  }
  const transitionNames = new Set(
    transitions.flatMap((transition) =>
      transition.steps.map((step) => step.change.name)
    ),
  );
  if (
    [...resources, ...deletes].some((item) =>
      item.resource === "repository-ruleset" && transitionNames.has(item.name)
    )
  ) throw new Error("incompatible GitHub ruleset transition");
  const deleted = new Set(
    deletes.map((item) => `${item.resource}\0${item.name}`),
  );
  if (
    deletes.length !== deleted.size ||
    resources.some((item) => deleted.has(`${item.resource}\0${item.name}`))
  ) {
    throw new Error("contradictory GitHub resource");
  }
  const settings = resources.filter((item) =>
    item.resource === "repository-setting"
  ).sort((left, right) => left.name.localeCompare(right.name));
  const rulesets = resources.filter((item) =>
    item.resource === "repository-ruleset"
  )
    .sort((left, right) => left.name.localeCompare(right.name));
  if (settings.length) await github.upsertResources(settings);
  // Main protection must be current before tag rules enter a transition state.
  for (const ruleset of rulesets) await github.upsertResources([ruleset]);
  for (const transition of transitions) {
    await applyTransition(github, transition);
  }
  // GitHub has no multi-ruleset transaction. Stop at the first failed request.
  for (
    const deletion of deletes.sort((left, right) =>
      left.name.localeCompare(right.name)
    )
  ) {
    await github.deleteResources([deletion]);
  }
}

async function verifyRemoteFilePreconditions(
  github: GithubWriter,
  preconditions: ChangePlan["preconditions"],
): Promise<void> {
  for (const condition of preconditions) {
    if (condition.kind !== "github-remote-file") continue;
    const remote = await github.remoteFile?.(condition.path);
    if (
      remote?.kind !== "file" || remote.content !== condition.expectedContent
    ) {
      throw new Error("GitHub remote file precondition failed");
    }
  }
}

async function applyTransition(
  github: GithubWriter,
  transition: GithubRulesetTransitionChange,
): Promise<void> {
  for (const step of transition.steps) {
    const current = await github.rulesets();
    if (!current || !matchesRulesets(current, step.before)) {
      throw new Error("GitHub ruleset transition precondition failed");
    }
    const target = current.find((item) => item.name === step.change.name);
    if (step.change.kind === "upsert") {
      await github.upsertResources([{
        resource: "repository-ruleset",
        name: step.change.name,
        definition: step.change.definition,
        expectedStateDigest: target?.stateDigest,
      }]);
    } else {
      if (!target) {
        throw new Error("GitHub ruleset transition precondition failed");
      }
      await github.deleteResources([{
        resource: "repository-ruleset",
        name: step.change.name,
        expectedStateDigest: target.stateDigest,
      }]);
    }
    const after = await github.rulesets();
    if (!after || !matchesRulesets(after, step.after)) {
      throw new Error("GitHub ruleset transition reread failed");
    }
  }
}

function verifyTransition(change: GithubRulesetTransitionChange): void {
  if (!change.steps.length) throw new Error("empty GitHub ruleset transition");
  for (const step of change.steps) {
    if (!step.before.length || !step.after.length) {
      throw new Error("incomplete GitHub ruleset transition");
    }
    for (const expected of [...step.before, ...step.after]) {
      if (!expected.name) throw new Error("invalid GitHub ruleset transition");
    }
  }
}

function matchesRulesets(
  current: readonly {
    name: string;
    definition: Record<string, unknown>;
    sourceType?: string;
  }[],
  expected: readonly GithubRulesetExpectation[],
): boolean {
  return expected.every((item) => {
    const matches = current.filter((ruleset) => ruleset.name === item.name);
    if (!item.definition) return matches.length === 0;
    if (
      matches.length !== 1 ||
      matches[0].sourceType !== "Repository"
    ) return false;
    const { id: _id, ...definition } = matches[0].definition;
    return JSON.stringify(canonical(definition)) ===
      JSON.stringify(item.definition);
  });
}

function rejectContradictoryResources(
  resources: readonly GithubResourceUpsert[],
): void {
  const names = new Set<string>();
  for (const resource of resources) {
    const key = resourceKey(resource.resource, resource.name);
    if (names.has(key)) {
      throw new Error(`contradictory GitHub resource: ${resource.name}`);
    }
    names.add(key);
  }
}

function resourceKey(resource: string, name: string): string {
  return `${resource}\0${name}`;
}
