/** @module Remote GitHub plan verifier and applicator. */
import type { ChangePlan } from "../api/change-plan.ts";
import type {
  GithubResourceDelete,
  GithubResourceUpsert,
  GithubWriter,
} from "../api/repository-context.ts";

export async function preflightGithubChangePlan(
  github: GithubWriter,
  plan: ChangePlan,
): Promise<void> {
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
  const resources: GithubResourceUpsert[] = [];
  const deletes: GithubResourceDelete[] = [];
  for (const plan of plans) {
    for (const change of plan.changes) {
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
  // GitHub has no multi-ruleset transaction. Stop at the first failed request.
  for (const ruleset of rulesets) await github.upsertResources([ruleset]);
  for (
    const deletion of deletes.sort((left, right) =>
      left.name.localeCompare(right.name)
    )
  ) {
    await github.deleteResources([deletion]);
  }
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
