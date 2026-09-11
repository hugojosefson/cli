/** @module Root-bound authenticated GitHub CLI adapter. */

import {
  githubCommandFailure,
  type GithubCommandRunner,
  localGithubCommand,
} from "./github-command.ts";
import {
  json,
  object,
  repositoryFromResponse,
  rulesetDefinition,
  rulesetDigest,
  rulesetId,
  safeRepositoryPath,
  withoutId,
} from "./github-response.ts";
import type {
  GithubBranch,
  GithubCommit,
  GithubOpenPullRequest,
  GithubProtection,
  GithubRemoteFile,
  GithubRepository,
  GithubResource,
  GithubResourceDelete,
  GithubResourceUpsert,
  GithubTag,
  GithubWorkflowRun,
  GithubWriter,
} from "../api/repository-context.ts";
import type { JsonObject, RepositoryPath } from "../api/json.ts";
import { digestBytes } from "./digest-bytes.ts";

const gitOid = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/** Uses `gh` without exposing its credentials to arguments or environment. */
export class LocalGithubClient implements GithubWriter {
  readonly #runner: GithubCommandRunner;
  #authenticated?: Promise<boolean>;
  #repository?: Promise<GithubRepository | undefined>;

  constructor(root: URL, runner?: GithubCommandRunner) {
    this.#runner = runner ?? localGithubCommand(root);
  }

  #diagnostics = new Set<string>();

  /** Safe details for reads that return unavailable data. */
  get diagnostics(): readonly string[] {
    return [...this.#diagnostics];
  }

  repository(): Promise<GithubRepository | undefined> {
    this.#repository ??= this.#loadRepository();
    return this.#repository;
  }

  async remoteFile(
    path: RepositoryPath,
  ): Promise<GithubRemoteFile | undefined> {
    const repository = await this.repository();
    if (!repository?.defaultBranch || !safeRepositoryPath(path)) {
      return undefined;
    }
    const query =
      `query($owner:String!,$name:String!,$expression:String!){repository(owner:$owner,name:$name){object(expression:$expression){... on Blob{text isBinary}}}}`;
    const output = await this.#run([
      "api",
      "graphql",
      "-f",
      `query=${query}`,
      "-F",
      `owner=${repository.owner}`,
      "-F",
      `name=${repository.name}`,
      "-F",
      `expression=${repository.defaultBranch}:${path}`,
    ]);
    const root = output && object(json(output));
    const data = object(root?.data);
    const repositoryData = object(data?.repository);
    if (!repositoryData || !("object" in repositoryData)) return undefined;
    if (repositoryData.object === null) return { kind: "absent" };
    const blob = object(repositoryData.object);
    if (!blob || blob.isBinary !== false || typeof blob.text !== "string") {
      return undefined;
    }
    return { kind: "file", content: blob.text };
  }

  async workflowRuns(
    path: RepositoryPath,
  ): Promise<readonly GithubWorkflowRun[] | undefined> {
    const repository = await this.repository();
    if (!repository || !safeRepositoryPath(path)) return undefined;
    const pages = await this.#pages(
      `repos/${repository.owner}/${repository.name}/actions/runs`,
    );
    if (!pages) return undefined;
    const runs: GithubWorkflowRun[] = [];
    for (const page of pages) {
      const records = object(page)?.workflow_runs;
      if (!Array.isArray(records)) return undefined;
      for (const record of records) {
        const item = object(record);
        const status = item?.status;
        const runPath = item?.path;
        if (typeof status !== "string" || typeof runPath !== "string") {
          return undefined;
        }
        if (runPath === path) runs.push({ status });
      }
    }
    return runs;
  }

  async openPullRequests(): Promise<
    readonly GithubOpenPullRequest[] | undefined
  > {
    const repository = await this.repository();
    if (!repository) return undefined;
    const pages = await this.#pages(
      `repos/${repository.owner}/${repository.name}/pulls?state=open`,
    );
    if (!pages) return undefined;
    const result: GithubOpenPullRequest[] = [];
    for (const page of pages) {
      if (!Array.isArray(page)) return undefined;
      for (const item of page) {
        const value = object(item);
        const head = object(value?.head)?.ref;
        if (
          typeof head !== "string" || !head ||
          typeof value?.title !== "string"
        ) {
          return undefined;
        }
        result.push({ head, title: value.title });
      }
    }
    return result;
  }

  async branches(): Promise<readonly GithubBranch[] | undefined> {
    const repository = await this.repository();
    if (!repository) return undefined;
    const pages = await this.#pages(
      `repos/${repository.owner}/${repository.name}/branches`,
    );
    if (!pages) return undefined;
    const result: GithubBranch[] = [];
    for (const page of pages) {
      if (!Array.isArray(page)) return undefined;
      for (const item of page) {
        const name = object(item)?.name;
        if (typeof name !== "string" || !name) return undefined;
        result.push({ name });
      }
    }
    return result;
  }

  async tags(): Promise<readonly GithubTag[] | undefined> {
    const repository = await this.repository();
    if (!repository) return undefined;
    const pages = await this.#pages(
      `repos/${repository.owner}/${repository.name}/git/matching-refs/tags/`,
    );
    if (!pages) return undefined;
    const result: GithubTag[] = [];
    for (const page of pages) {
      if (!Array.isArray(page)) return undefined;
      for (const item of page) {
        const value = object(item);
        const ref = value?.ref;
        const target = object(value?.object);
        if (
          typeof ref !== "string" || !ref.startsWith("refs/tags/") ||
          typeof target?.sha !== "string" || !gitOid.test(target.sha) ||
          (target.type !== "commit" && target.type !== "tag")
        ) return undefined;
        if (target.type === "commit") {
          result.push({
            name: ref.slice("refs/tags/".length),
            target: target.sha,
            lightweight: true,
          });
          continue;
        }
        const detail = await this.#run([
          "api",
          `repos/${repository.owner}/${repository.name}/git/tags/${target.sha}`,
        ]);
        const commit = detail && object(json(detail))?.object;
        if (
          object(commit)?.type !== "commit" ||
          typeof object(commit)?.sha !== "string" ||
          !gitOid.test(object(commit)!.sha as string)
        ) return undefined;
        result.push({
          name: ref.slice("refs/tags/".length),
          target: object(commit)!.sha as string,
          lightweight: false,
        });
      }
    }
    return result;
  }

  async defaultBranchCommits(): Promise<readonly GithubCommit[] | undefined> {
    const repository = await this.repository();
    if (!repository?.defaultBranch) return undefined;
    const query =
      "query($owner:String!,$name:String!,$qualifiedName:String!,$cursor:String){repository(owner:$owner,name:$name){ref(qualifiedName:$qualifiedName){target{... on Commit{history(first:100,after:$cursor){nodes{oid messageHeadline}pageInfo{hasNextPage endCursor}}}}}}}";
    const commits: GithubCommit[] = [];
    let cursor: string | undefined;
    const seen = new Set<string>();
    for (let pageNumber = 1; pageNumber <= 10_000; pageNumber++) {
      const output = await this.#run([
        "api",
        "graphql",
        "-f",
        `query=${query}`,
        "-F",
        `owner=${repository.owner}`,
        "-F",
        `name=${repository.name}`,
        "-F",
        `qualifiedName=refs/heads/${repository.defaultBranch}`,
        ...(cursor ? ["-F", `cursor=${cursor}`] : []),
      ]);
      const history = output &&
        object(object(object(object(json(output))?.data)?.repository)?.ref)
          ?.target;
      const value = object(history)?.history;
      const nodes = object(value)?.nodes;
      const pageInfo = object(value)?.pageInfo;
      const hasNextPage = object(pageInfo)?.hasNextPage;
      const endCursor = object(pageInfo)?.endCursor;
      if (
        !Array.isArray(nodes) || typeof hasNextPage !== "boolean" ||
        (hasNextPage && typeof endCursor !== "string")
      ) return undefined;
      for (const node of nodes) {
        const item = object(node);
        if (
          typeof item?.oid !== "string" || !gitOid.test(item.oid) ||
          typeof item.messageHeadline !== "string"
        ) return undefined;
        commits.push({ oid: item.oid, subject: item.messageHeadline });
      }
      if (!hasNextPage) return commits;
      const nextCursor = endCursor as string;
      if (seen.has(nextCursor)) return undefined;
      seen.add(nextCursor);
      cursor = nextCursor;
    }
    return undefined;
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
    return output ? repositoryFromResponse(json(output)) : undefined;
  }

  rulesets(): Promise<readonly GithubResource[] | undefined> {
    return this.#rulesets();
  }
  async tagRulesetEligibility(): Promise<
    "eligible" | "ineligible" | undefined
  > {
    const repository = await this.repository();
    if (!repository) return undefined;
    const metadata = await this.#repositorySettings(repository);
    const visibility = metadata?.visibility;
    const owner = object(metadata?.owner);
    const ownerType = owner?.type;
    const ownerLogin = owner?.login;
    if (visibility === "public") return "eligible";
    if (
      (visibility !== "private" && visibility !== "internal") ||
      typeof ownerType !== "string" || typeof ownerLogin !== "string"
    ) return undefined;
    const endpoint = ownerType === "User"
      ? `users/${ownerLogin}`
      : ownerType === "Organization"
      ? `orgs/${ownerLogin}`
      : undefined;
    if (!endpoint) return undefined;
    const response = await this.#run(["api", endpoint]);
    const plan = response && object(json(response));
    const planName = object(plan?.plan)?.name;
    if (typeof planName !== "string") return undefined;
    const enterprise = planName.toLowerCase().includes("enterprise");
    if (visibility === "internal") {
      return enterprise ? "eligible" : "ineligible";
    }
    if (ownerType === "User") {
      return planName.toLowerCase() === "pro" ? "eligible" : "ineligible";
    }
    return enterprise || planName.toLowerCase() === "team"
      ? "eligible"
      : "ineligible";
  }
  async protection(): Promise<GithubProtection | undefined> {
    const repository = await this.repository();
    if (!repository) return undefined;
    const rulesets = await this.#rulesets();
    const settings = await this.#repositorySettings(repository);
    const actions = await this.#actionsWorkflowSettings(repository);
    const legacy = await this.#legacyBranchProtection(repository);
    if (
      !rulesets || rulesets.some((ruleset) => ruleset.source === undefined) ||
      !settings || !actions || legacy === null
    ) return undefined;
    return {
      rulesets,
      repository: settings,
      actions,
      legacyBranchProtection: legacy,
    };
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
        matches[0].sourceType !== "Repository" ||
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
    const pages = await this.#pages(
      `repos/${repository.owner}/${repository.name}/rulesets?includes_parents=true`,
    );
    if (!pages) return undefined;
    for (const page of pages) {
      if (!Array.isArray(page)) return undefined;
      listed.push(...page);
    }
    const resources: GithubResource[] = [];
    for (const summary of listed) {
      if (
        summary === null || typeof summary !== "object" ||
        typeof (summary as { source_type?: unknown }).source_type !== "string"
      ) return undefined;
      const id = rulesetId(summary);
      if (id === undefined) return undefined;
      const detail = await this.#run([
        "api",
        `repos/${repository.owner}/${repository.name}/rulesets/${id}`,
      ]);
      const definition = detail && rulesetDefinition(json(detail));
      if (!definition) return undefined;
      resources.push({
        kind: "repository-ruleset",
        name: definition.name as string,
        definition: { ...definition, id },
        stateDigest: await rulesetDigest(definition),
        sourceType: (summary as { source_type: string }).source_type,
        ...(typeof (summary as { source?: unknown }).source === "string"
          ? { source: (summary as { source: string }).source }
          : {}),
      });
    }
    return resources;
  }
  async #legacyBranchProtection(
    repository: GithubRepository,
  ): Promise<JsonObject | undefined | null> {
    if (!repository.defaultBranch) return null;
    const branch = await this.#run([
      "api",
      `repos/${repository.owner}/${repository.name}/branches/${repository.defaultBranch}`,
    ]);
    const protectedBranch = branch && object(json(branch))?.protected;
    if (typeof protectedBranch !== "boolean") return null;
    if (!protectedBranch) return undefined;
    const output = await this.#run([
      "api",
      `repos/${repository.owner}/${repository.name}/branches/${repository.defaultBranch}/protection`,
    ]);
    return output === undefined ? null : object(json(output)) ?? null;
  }
  async #upsertRuleset(resource: GithubResourceUpsert): Promise<void> {
    const current = await this.#rulesets();
    if (!current) throw new Error("GitHub rulesets unavailable");
    const matches = current.filter((item) => item.name === resource.name);
    if (
      matches.length > 1 ||
      matches.length === 1 && matches[0].sourceType !== "Repository" ||
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
    const value = await this.#actionsWorkflowSettings(repository);
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

  async #actionsWorkflowSettings(
    repository: GithubRepository,
  ): Promise<JsonObject | undefined> {
    const output = await this.#run([
      "api",
      `repos/${repository.owner}/${repository.name}/actions/permissions/workflow`,
    ]);
    return output === undefined ? undefined : object(json(output));
  }

  /** REST pagination is bounded and rejects a repeated page rather than guessing. */
  async #pages(endpoint: string): Promise<readonly unknown[] | undefined> {
    const pages: unknown[] = [];
    const seen = new Set<string>();
    for (let page = 1; page <= 10_000; page++) {
      const separator = endpoint.includes("?") ? "&" : "?";
      const output = await this.#run([
        "api",
        `${endpoint}${separator}per_page=100&page=${page}`,
      ]);
      if (!output) return undefined;
      const value = json(output);
      const fingerprint = JSON.stringify(value);
      if (seen.has(fingerprint)) return undefined;
      seen.add(fingerprint);
      pages.push(value);
      const items = Array.isArray(value)
        ? value
        : Array.isArray(object(value)?.workflow_runs)
        ? object(value)?.workflow_runs as readonly unknown[]
        : undefined;
      if (!items) return undefined;
      if (items.length < 100) return pages;
    }
    return undefined;
  }

  async #run(args: readonly string[]): Promise<Uint8Array | undefined> {
    try {
      const result = await this.#runner.run(args);
      if (result.success) return result.stdout;
      this.#diagnostics.add(githubCommandFailure(args, result));
    } catch {
      this.#diagnostics.add(githubCommandFailure(args));
    }
    return undefined;
  }
  async #runOrThrow(args: readonly string[], stdin?: string): Promise<void> {
    let result;
    try {
      result = await this.#runner.run(args, stdin);
    } catch {
      throw new Error(githubCommandFailure(args));
    }
    if (!result.success) throw new Error(githubCommandFailure(args, result));
  }
}

async function digest(name: string, value: boolean): Promise<string> {
  return await digestBytes(
    new TextEncoder().encode(JSON.stringify({ [name]: value })),
  );
}
