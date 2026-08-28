/** @module Remote GitHub plan verifier and applicator. */
import type { ChangePlan } from "../api/change-plan.ts";
import type {
  GithubResourceUpsert,
  GithubWriter,
} from "../api/repository-context.ts";

export async function preflightGithubChangePlan(
  github: GithubWriter,
  plan: ChangePlan,
): Promise<void> {
  for (const condition of plan.preconditions) {
    if (condition.kind !== "github-resource-state") continue;
    const resource = await github.resource(condition.resource, condition.name);
    if (resource?.stateDigest !== condition.stateDigest) {
      throw new Error("GitHub resource precondition failed");
    }
  }
  for (const change of plan.changes) {
    if (
      change.kind === "upsert-github-resource" &&
      change.resource !== "repository-setting"
    ) {
      throw new Error("unsupported GitHub resource");
    }
    if (
      change.kind === "delete-github-resource" || change.kind === "app-setup"
    ) {
      throw new Error("unsupported GitHub operation");
    }
  }
}
export async function applyGithubChangePlans(
  github: GithubWriter,
  plans: readonly ChangePlan[],
): Promise<void> {
  const resources: GithubResourceUpsert[] = [];
  for (const plan of plans) {
    for (const change of plan.changes) {
      if (change.kind !== "upsert-github-resource") continue;
      if (change.resource !== "repository-setting") {
        throw new Error("unsupported GitHub resource");
      }
      if (change.expectedStateDigest === undefined) {
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
  if (resources.length) await github.upsertResources(resources);
}

function rejectContradictoryResources(
  resources: readonly GithubResourceUpsert[],
): void {
  const definitions = new Map<string, string>();
  for (const resource of resources) {
    const key = `${resource.resource}\0${resource.name}`;
    const definition = JSON.stringify(resource.definition);
    const previous = definitions.get(key);
    if (previous !== undefined && previous !== definition) {
      throw new Error(`contradictory GitHub resource: ${resource.name}`);
    }
    definitions.set(key, definition);
  }
}
