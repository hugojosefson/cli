/** @module Root-bound authenticated GitHub CLI adapter. */

import type {
  GithubRepository,
  GithubResource,
  GithubResourceDelete,
  GithubResourceUpsert,
  GithubWriter,
} from "../api/repository-context.ts";
import type { JsonObject } from "../api/json.ts";
import { digestBytes } from "./digest-bytes.ts";

export interface GithubCommandRunner {
  run(
    args: readonly string[],
    stdin?: string,
  ): Promise<{ readonly success: boolean; readonly stdout: Uint8Array }>;
}

/** Uses `gh` without exposing its credentials to arguments or environment. */
export class LocalGithubClient implements GithubWriter {
  readonly #runner: GithubCommandRunner;
  #authenticated?: Promise<boolean>;
  #repository?: Promise<GithubRepository | undefined>;

  constructor(root: URL, runner?: GithubCommandRunner) {
    this.#runner = runner ?? {
      run: async (args, stdin) => {
        const child = new Deno.Command("gh", {
          args: [...args],
          cwd: root.pathname,
          stdin: stdin === undefined ? "null" : "piped",
          stdout: "piped",
          stderr: "null",
        }).spawn();
        if (stdin !== undefined) {
          const writer = child.stdin.getWriter();
          await writer.write(new TextEncoder().encode(stdin));
          await writer.close();
        }
        return await child.output();
      },
    };
  }

  repository(): Promise<GithubRepository | undefined> {
    this.#repository ??= this.#loadRepository();
    return this.#repository;
  }

  async #loadRepository(): Promise<GithubRepository | undefined> {
    if (!await this.#isAuthenticated()) {
      return undefined;
    }
    const output = await this.#run([
      "repo",
      "view",
      "--json",
      "nameWithOwner,defaultBranchRef",
    ]);
    const value = output &&
      json(output) as {
        nameWithOwner?: string;
        defaultBranchRef?: { name?: string };
      };
    const [owner, name] = value?.nameWithOwner?.split("/") ?? [];
    return owner && name
      ? { owner, name, defaultBranch: value?.defaultBranchRef?.name }
      : undefined;
  }

  rulesets(): Promise<readonly GithubResource[] | undefined> {
    return this.#rulesets();
  }
  environments(): Promise<readonly GithubResource[]> {
    return Promise.resolve([]);
  }
  variables(): Promise<readonly GithubResource[]> {
    return Promise.resolve([]);
  }
  secretExists(): Promise<boolean | undefined> {
    return Promise.resolve(undefined);
  }

  async resource(
    kind: string,
    name: string,
  ): Promise<GithubResource | undefined> {
    const repository = await this.repository();
    if (!repository) return undefined;
    if (kind === "actions-workflow-permission") {
      return await this.#actionsWorkflowPermission(repository, name);
    }
    if (kind === "repository-ruleset") {
      const matches = (await this.#rulesets())?.filter((item) =>
        item.name === name
      );
      return matches?.length === 1 ? matches[0] : undefined;
    }
    if (kind !== "repository-setting") return undefined;
    const definition = await this.#repositorySettings(repository);
    if (!definition || typeof definition[name] !== "boolean") return undefined;
    return {
      kind,
      name,
      definition: { value: definition[name] },
      stateDigest: await digest(name, definition[name]),
    };
  }

  async upsertResources(
    resources: readonly GithubResourceUpsert[],
  ): Promise<void> {
    const settings = resources.filter((item) =>
      item.resource === "repository-setting"
    );
    const rulesets = resources.filter((item) =>
      item.resource === "repository-ruleset"
    );
    if (settings.length && rulesets.length) {
      throw new Error("incompatible GitHub resources");
    }
    if (rulesets.length) {
      if (
        rulesets.length !== resources.length ||
        new Set(rulesets.map((item) => item.name)).size !== rulesets.length
      ) throw new Error("contradictory GitHub resource");
      for (const ruleset of rulesets) await this.#upsertRuleset(ruleset);
      return;
    }
    const repository = await this.repository();
    if (!repository) throw new Error("GitHub repository unavailable");
    const values: Record<string, boolean> = {};
    for (const resource of resources) {
      if (
        resource.resource !== "repository-setting" ||
        typeof resource.definition.value !== "boolean"
      ) throw new Error("unsupported GitHub resource");
      const previous = values[resource.name];
      if (previous !== undefined && previous !== resource.definition.value) {
        throw new Error(`contradictory GitHub resource: ${resource.name}`);
      }
      values[resource.name] = resource.definition.value;
    }
    const current = await this.#repositorySettings(repository);
    if (!current) throw new Error("GitHub repository settings unavailable");
    for (const resource of resources) {
      const value = current[resource.name];
      if (
        typeof value !== "boolean" ||
        await digest(resource.name, value) !== resource.expectedStateDigest
      ) {
        throw new Error("GitHub resource precondition failed");
      }
    }
    await this.#runOrThrow([
      "api",
      "--method",
      "PATCH",
      `repos/${repository.owner}/${repository.name}`,
      "--input",
      "-",
    ], JSON.stringify(values));
  }

  async deleteResources(
    resources: readonly GithubResourceDelete[],
  ): Promise<void> {
    for (const resource of resources) {
      if (resource.resource !== "repository-ruleset") {
        throw new Error("unsupported GitHub resource");
      }
      const current = await this.#rulesets();
      if (!current) throw new Error("GitHub rulesets unavailable");
      const matches = current.filter((item) => item.name === resource.name);
      if (
        matches.length !== 1 ||
        matches[0].stateDigest !== resource.expectedStateDigest
      ) {
        throw new Error("GitHub resource precondition failed");
      }
      const repository = await this.repository();
      if (!repository) throw new Error("GitHub repository unavailable");
      const id = rulesetId(matches[0].definition);
      if (id === undefined) throw new Error("GitHub ruleset unavailable");
      await this.#runOrThrow([
        "api",
        "--method",
        "DELETE",
        `repos/${repository.owner}/${repository.name}/rulesets/${id}`,
      ]);
    }
  }

  #isAuthenticated(): Promise<boolean> {
    this.#authenticated ??= this.#loadAuthentication();
    return this.#authenticated;
  }

  async #loadAuthentication(): Promise<boolean> {
    const output = await this.#run(["api", "user"]);
    const value = output && json(output) as { login?: unknown };
    return typeof value?.login === "string" &&
      value.login.length > 0;
  }

  async #repositorySettings(
    repository: GithubRepository,
  ): Promise<JsonObject | undefined> {
    const output = await this.#run([
      "api",
      `repos/${repository.owner}/${repository.name}`,
    ]);
    const value = output && json(output);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as JsonObject
      : undefined;
  }
  async #rulesets(): Promise<readonly GithubResource[] | undefined> {
    const repository = await this.repository();
    if (!repository) return undefined;
    const listed: unknown[] = [];
    for (let page = 1;; page++) {
      const output = await this.#run([
        "api",
        `repos/${repository.owner}/${repository.name}/rulesets?includes_parents=false&per_page=100&page=${page}`,
      ]);
      const items = output && json(output);
      if (!Array.isArray(items)) return undefined;
      listed.push(...items);
      if (items.length < 100) break;
    }
    const resources: GithubResource[] = [];
    for (const summary of listed) {
      if (
        summary === null || typeof summary !== "object" ||
        typeof (summary as { source_type?: unknown }).source_type !== "string"
      ) return undefined;
      if ((summary as { source_type: string }).source_type !== "Repository") {
        continue;
      }
      const id = rulesetId(summary);
      if (id === undefined) return undefined;
      const detail = await this.#run([
        "api",
        `repos/${repository.owner}/${repository.name}/rulesets/${id}?includes_parents=false`,
      ]);
      const definition = detail && rulesetDefinition(json(detail));
      if (!definition) return undefined;
      resources.push({
        kind: "repository-ruleset",
        name: definition.name as string,
        definition: { ...definition, id },
        stateDigest: await rulesetDigest(definition),
      });
    }
    return resources;
  }
  async #upsertRuleset(resource: GithubResourceUpsert): Promise<void> {
    const current = await this.#rulesets();
    if (!current) throw new Error("GitHub rulesets unavailable");
    const matches = current.filter((item) => item.name === resource.name);
    if (
      matches.length > 1 ||
      matches.length === 1 &&
        matches[0].stateDigest !== resource.expectedStateDigest ||
      matches.length === 0 && resource.expectedStateDigest !== undefined
    ) throw new Error("GitHub resource precondition failed");
    const repository = await this.repository();
    if (!repository) throw new Error("GitHub repository unavailable");
    const definition = withoutId(resource.definition);
    if (definition.name !== resource.name) {
      throw new Error("contradictory GitHub resource");
    }
    const endpoint = matches.length
      ? `repos/${repository.owner}/${repository.name}/rulesets/${
        rulesetId(matches[0].definition)
      }`
      : `repos/${repository.owner}/${repository.name}/rulesets`;
    await this.#runOrThrow([
      "api",
      "--method",
      matches.length ? "PUT" : "POST",
      endpoint,
      "--input",
      "-",
    ], JSON.stringify(definition));
  }
  async #actionsWorkflowPermission(
    repository: GithubRepository,
    name: string,
  ): Promise<GithubResource | undefined> {
    if (name !== "can-approve-pull-request-reviews") return undefined;
    const output = await this.#run([
      "api",
      `repos/${repository.owner}/${repository.name}/actions/permissions/workflow`,
    ]);
    const value = output && json(output) as {
      can_approve_pull_request_reviews?: unknown;
    };
    if (typeof value?.can_approve_pull_request_reviews !== "boolean") {
      return undefined;
    }
    return {
      kind: "actions-workflow-permission",
      name,
      definition: { value: value.can_approve_pull_request_reviews },
      stateDigest: await digest(name, value.can_approve_pull_request_reviews),
    };
  }

  async #run(args: readonly string[]): Promise<Uint8Array | undefined> {
    try {
      const result = await this.#runner.run(args);
      return result.success ? result.stdout : undefined;
    } catch {
      return undefined;
    }
  }
  async #runOrThrow(args: readonly string[], stdin?: string): Promise<void> {
    const result = await this.#runner.run(args, stdin);
    if (!result.success) throw new Error("GitHub mutation failed");
  }
}

function json(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}
async function digest(name: string, value: boolean): Promise<string> {
  return await digestBytes(
    new TextEncoder().encode(JSON.stringify({ [name]: value })),
  );
}

function rulesetId(value: unknown): number | undefined {
  const id = value !== null && typeof value === "object"
    ? (value as { id?: unknown }).id
    : undefined;
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0
    ? id
    : undefined;
}
function rulesetDefinition(value: unknown): JsonObject | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const object = value as Record<string, unknown>;
  if (
    typeof object.name !== "string" || typeof object.target !== "string" ||
    typeof object.enforcement !== "string" || !Array.isArray(object.rules) ||
    !Array.isArray(object.bypass_actors) || object.conditions === null ||
    typeof object.conditions !== "object"
  ) return undefined;
  return canonical({
    name: object.name,
    target: object.target,
    enforcement: object.enforcement,
    bypass_actors: object.bypass_actors,
    conditions: object.conditions,
    rules: object.rules,
  }) as JsonObject;
}
function withoutId(value: JsonObject): JsonObject {
  const { id: _id, ...definition } = value;
  return definition;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonical).sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right))
    );
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}
async function rulesetDigest(definition: JsonObject): Promise<string> {
  return await digestBytes(
    new TextEncoder().encode(JSON.stringify(definition)),
  );
}
