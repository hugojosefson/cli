/** @module Root-bound authenticated GitHub CLI adapter. */

import type {
  GithubRepository,
  GithubResource,
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

  rulesets(): Promise<readonly GithubResource[]> {
    return Promise.resolve([]);
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
  async #runOrThrow(args: readonly string[], stdin: string): Promise<void> {
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
