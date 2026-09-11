/** Concrete, fail-closed gh and git adapter for tag publication. */

import {
  type ApplyGithub,
  type ApplyPullRequest,
  PullRequestCleanStatusError,
  ReleasePullRequestNotFoundError,
} from "./apply-types.ts";
import type { RecoveryGithub } from "./publish-tag-recovery.ts";
import { parseReleaseOwnershipMarker } from "./release-pr.ts";
import type { ReleaseProcess } from "./release-process.ts";
import type { SyntheticCheckRun } from "./synthetic-check.ts";
import { publishTagSuccessEvent } from "./names.ts";
import { parseSemver } from "./semver.ts";

type Repository = { readonly owner: string; readonly name: string };
type Json = Record<string, unknown>;

const shaPattern = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const cleanStatusMessage = "Pull request Pull request is in clean status";

export type PublishTagGithubApi = ApplyGithub & RecoveryGithub & {
  pushReleaseBranch(branch: string, sha: string): Promise<void>;
  createReleasePullRequest(
    input: { title: string; body: string; head: string },
  ): Promise<void>;
};

/** Does not inspect credentials; `GH_TOKEN`, when supplied, remains inherited by gh. */
export function publishTagGithub(
  process: ReleaseProcess,
  repository: Repository,
  releaseBranch: string,
): PublishTagGithubApi {
  requireRepository(repository);
  requireBranch(releaseBranch);
  const api = new PublishTagGithub(process, repository, releaseBranch);
  return api;
}

class PublishTagGithub implements ApplyGithub, RecoveryGithub {
  readonly #process: ReleaseProcess;
  readonly #repository: Repository;
  readonly #branch: string;
  #pullRequestId: string | undefined;

  constructor(
    process: ReleaseProcess,
    repository: Repository,
    branch: string,
  ) {
    this.#process = process;
    this.#repository = repository;
    this.#branch = branch;
  }

  async readPullRequest(): Promise<ApplyPullRequest> {
    if (this.#pullRequestId !== undefined) {
      const data = await this.#graphql(
        pullRequestByIdQuery,
        { pullRequestId: this.#pullRequestId },
      );
      const value = object(data)?.node;
      const pr = pullRequest(value, this.#slug(), this.#branch);
      if (pr.id !== this.#pullRequestId) {
        throw new TypeError("Pull request response is invalid.");
      }
      return pr;
    }
    const nodes: unknown[] = [];
    let cursor: string | undefined;
    const cursors = new Set<string>();
    while (true) {
      const data = await this.#graphql(
        prQuery,
        this.#variables({ branch: this.#branch, cursor }),
      );
      const connection = object(object(data)?.repository)?.pullRequests;
      const pageNodes = array(object(connection)?.nodes);
      const pageInfo = object(object(connection)?.pageInfo);
      if (
        !pageNodes || !pageInfo || typeof pageInfo.hasNextPage !== "boolean" ||
        (pageInfo.hasNextPage && typeof pageInfo.endCursor !== "string")
      ) {
        throw new TypeError("Pull-request page is invalid.");
      }
      nodes.push(...pageNodes);
      if (!pageInfo.hasNextPage) break;
      cursor = pageInfo.endCursor as string;
      if (cursors.has(cursor)) throw new TypeError("Pull-request pages loop.");
      cursors.add(cursor);
    }
    if (nodes.length === 0) throw new ReleasePullRequestNotFoundError();
    if (nodes.length !== 1) {
      throw new TypeError("Release pull requests are ambiguous.");
    }
    const pr = pullRequest(nodes[0], this.#slug(), this.#branch);
    this.#pullRequestId = pr.id;
    return pr;
  }

  async listCheckRuns(sha: string): Promise<readonly SyntheticCheckRun[]> {
    requireSha(sha);
    const result = await this.#run("gh", [
      "api",
      "--paginate",
      "--slurp",
      `repos/${this.#slug()}/commits/${sha}/check-runs?filter=all&per_page=100`,
    ]);
    const pages = jsonPages(result);
    return pages.flatMap((page) => {
      const runs = array(object(page)?.check_runs);
      if (!runs) throw new TypeError("Check-run page is invalid.");
      return runs.map(checkRun);
    });
  }

  async createCheckRun(input: {
    name: string;
    headSha: string;
    externalId: string;
    detailsUrl: string;
  }): Promise<SyntheticCheckRun> {
    requireSha(input.headSha);
    const value = await this.#jsonApi(
      [
        "api",
        `repos/${this.#slug()}/check-runs`,
        "--method",
        "POST",
        "--input",
        "-",
      ],
      {
        name: input.name,
        head_sha: input.headSha,
        status: "in_progress",
        external_id: input.externalId,
        details_url: input.detailsUrl,
      },
    );
    return checkRun(value);
  }

  async completeCheckRun(
    id: number,
    conclusion: "success" | "neutral" | "cancelled",
  ): Promise<void> {
    if (!Number.isSafeInteger(id) || id < 1) {
      throw new TypeError("Check run ID is invalid.");
    }
    await this.#jsonApi(
      [
        "api",
        `repos/${this.#slug()}/check-runs/${id}`,
        "--method",
        "PATCH",
        "--input",
        "-",
      ],
      { status: "completed", conclusion },
    );
  }

  async disablePullRequestAutoMerge(id: string): Promise<void> {
    requireMutationPullRequest(
      await this.#graphql(disableMutation, { pullRequestId: id }),
      "disablePullRequestAutoMerge",
      id,
    );
  }

  async enablePullRequestAutoMerge(input: {
    id: string;
    mergeMethod: "REBASE";
    expectedHeadOid: string;
  }): Promise<void> {
    requireSha(input.expectedHeadOid);
    try {
      requireMutationPullRequest(
        await this.#graphql(enableMutation, {
          pullRequestId: input.id,
          mergeMethod: input.mergeMethod,
          expectedHeadOid: input.expectedHeadOid,
        }),
        "enablePullRequestAutoMerge",
        input.id,
      );
    } catch (error) {
      if (
        error instanceof GraphqlError && error.messages.length === 1 &&
        error.messages[0] === cleanStatusMessage
      ) {
        throw new PullRequestCleanStatusError(cleanStatusMessage);
      }
      throw error;
    }
  }

  async fetchMainSha(): Promise<string> {
    await this.#run("git", [
      "fetch",
      "origin",
      "+refs/heads/main:refs/remotes/origin/main",
    ]);
    const sha = singleLine(
      await this.#run("git", ["rev-parse", "origin/main^{commit}"]),
    );
    requireSha(sha);
    return sha;
  }

  async deleteReleaseBranchWithLease(
    branch: string,
    sha: string,
  ): Promise<"deleted" | "missing" | "lease-mismatch"> {
    if (branch !== this.#branch) throw new TypeError("Release branch differs.");
    requireSha(sha);
    const before = await this.#branchSha(branch);
    if (before === undefined) return "missing";
    if (before !== sha) return "lease-mismatch";
    const result = await this.#process.run("git", [
      "push",
      `--force-with-lease=refs/heads/${branch}:${sha}`,
      "origin",
      `:refs/heads/${branch}`,
    ]);
    if (result.success) return "deleted";
    const after = await this.#branchSha(branch);
    if (after === undefined) return "missing";
    if (after !== sha) return "lease-mismatch";
    throw new Error("Release branch deletion was not confirmed.");
  }

  async closePullRequest(id: string): Promise<void> {
    requireMutationPullRequest(
      await this.#graphql(closeMutation, { pullRequestId: id }),
      "closePullRequest",
      id,
    );
  }

  /** Pushes only the exact release ref; a caller always reads it again. */
  async pushReleaseBranch(branch: string, sha: string): Promise<void> {
    if (branch !== this.#branch) throw new TypeError("Release branch differs.");
    requireSha(sha);
    await this.#run("git", ["push", "origin", `${sha}:refs/heads/${branch}`]);
  }

  /** Creates a PR through the REST endpoint; identity is confirmed by a fresh read. */
  async createReleasePullRequest(input: {
    title: string;
    body: string;
    head: string;
  }): Promise<void> {
    if (input.head !== this.#branch || !input.title || !input.body) {
      throw new TypeError("Release pull request is invalid.");
    }
    await this.#jsonApi(
      [
        "api",
        `repos/${this.#slug()}/pulls`,
        "--method",
        "POST",
        "--input",
        "-",
      ],
      { title: input.title, body: input.body, head: input.head, base: "main" },
    );
  }

  async readTag(tag: string): Promise<string | undefined> {
    requireTag(tag);
    const text = await this.#run("git", [
      "ls-remote",
      "--tags",
      "origin",
      `refs/tags/${tag}`,
      `refs/tags/${tag}^{}`,
    ]);
    return tagTarget(text, tag);
  }

  async pushLightweightTag(tag: string, target: string): Promise<void> {
    requireTag(tag);
    requireSha(target);
    await this.#run("git", ["push", "origin", `${target}:refs/tags/${tag}`]);
  }

  async readReleaseBranch(): Promise<string | undefined> {
    return await this.#branchSha(this.#branch);
  }

  async mergedPullRequestsForReleaseBranch(): Promise<
    readonly { ownership: ReturnType<typeof parseReleaseOwnershipMarker> }[]
  > {
    const values: {
      ownership: ReturnType<typeof parseReleaseOwnershipMarker>;
    }[] = [];
    let cursor: string | undefined;
    const cursors = new Set<string>();
    while (true) {
      const data = await this.#graphql(
        mergedPrQuery,
        this.#variables({ branch: this.#branch, cursor }),
      );
      const root = object(data);
      const connection = object(root?.repository)?.pullRequests;
      const nodes = array(object(connection)?.nodes);
      const pageInfo = object(object(connection)?.pageInfo);
      if (
        !nodes || !pageInfo || typeof pageInfo.hasNextPage !== "boolean" ||
        (pageInfo.hasNextPage && typeof pageInfo.endCursor !== "string")
      ) {
        throw new TypeError("Merged pull-request page is invalid.");
      }
      for (const node of nodes) {
        const item = object(node);
        requirePullRequestCoordinates(
          item,
          this.#slug(),
          this.#branch,
        );
        const body = string(item?.body);
        if (body === undefined) {
          throw new TypeError("Merged pull-request response is invalid.");
        }
        values.push({ ownership: parseReleaseOwnershipMarker(body) });
      }
      if (!pageInfo.hasNextPage) return values;
      cursor = pageInfo.endCursor as string;
      if (cursors.has(cursor)) {
        throw new TypeError("Merged pull-request pages loop.");
      }
      cursors.add(cursor);
    }
  }

  async sendSuccessEvent(
    payload: { schema: 1; version: string; tag: string; releaseSha: string },
  ): Promise<void> {
    requireSha(payload.releaseSha);
    requireTag(payload.version);
    if (payload.schema !== 1 || payload.tag !== payload.version) {
      throw new TypeError("Release event payload is invalid.");
    }
    await this.#noBodyApi(
      [
        "api",
        `repos/${this.#slug()}/dispatches`,
        "--method",
        "POST",
        "--input",
        "-",
      ],
      { event_type: publishTagSuccessEvent, client_payload: payload },
    );
  }

  async #branchSha(branch: string): Promise<string | undefined> {
    const text = await this.#run("git", [
      "ls-remote",
      "--heads",
      "origin",
      `refs/heads/${branch}`,
    ]);
    if (!text) return undefined;
    const match = /^([0-9a-f]{40}(?:[0-9a-f]{24})?)\t([^\n]+)\n$/.exec(
      text,
    );
    if (
      !match || !shaPattern.test(match[1]) ||
      match[2] !== `refs/heads/${branch}`
    ) {
      throw new TypeError("Release branch response is invalid.");
    }
    return match[1];
  }

  async #graphql(
    query: string,
    variables: Record<string, string | undefined>,
  ): Promise<Json> {
    const args = ["api", "graphql", "-f", `query=${query}`];
    for (const [key, value] of Object.entries(variables)) {
      if (value !== undefined) args.push("-F", `${key}=${value}`);
    }
    const result = await this.#process.run("gh", args);
    const value = parseJson(text(result.stdout));
    const response = object(value);
    if (!response) throw new TypeError("GitHub GraphQL response is invalid.");
    if ("errors" in response) {
      const errors = array(response.errors);
      if (!errors) throw new TypeError("GitHub GraphQL errors are invalid.");
      if (errors.length) throw new GraphqlError(errors.map(graphqlMessage));
    }
    if (!result.success) throw new Error("GitHub GraphQL request failed.");
    const data = object(response.data);
    if (!data) throw new TypeError("GitHub GraphQL response is invalid.");
    return data;
  }

  async #jsonApi(args: string[], payload: Json): Promise<Json> {
    const result = await this.#process.run("gh", args, {
      stdin: JSON.stringify(payload),
    });
    if (!result.success) throw new Error("GitHub API request failed.");
    return object(parseJson(text(result.stdout))) ??
      fail("GitHub API response is invalid.");
  }

  async #noBodyApi(args: string[], payload: Json): Promise<void> {
    const result = await this.#process.run("gh", args, {
      stdin: JSON.stringify(payload),
    });
    if (!result.success) throw new Error("GitHub API request failed.");
    if (text(result.stdout).trim()) {
      throw new TypeError("GitHub API response must be empty.");
    }
  }

  async #run(command: string, args: string[]): Promise<string> {
    const result = await this.#process.run(command, args);
    if (!result.success) throw new Error(`Release command failed: ${command}.`);
    return text(result.stdout);
  }

  #slug(): string {
    return `${this.#repository.owner}/${this.#repository.name}`;
  }

  #variables(
    values: Record<string, string | undefined>,
  ): Record<string, string | undefined> {
    return {
      owner: this.#repository.owner,
      name: this.#repository.name,
      ...values,
    };
  }
}

class GraphqlError extends Error {
  constructor(readonly messages: readonly string[]) {
    super("GitHub GraphQL request failed.");
  }
}

function pullRequest(
  value: unknown,
  repository: string,
  branch: string,
): ApplyPullRequest {
  const item = object(value);
  requirePullRequestCoordinates(item, repository, branch);
  const autoMerge = item && item.autoMergeRequest === null
    ? undefined
    : object(item?.autoMergeRequest);
  const enabledBy = object(autoMerge?.enabledBy);
  const id = string(item?.id);
  const title = string(item?.title);
  const state = string(item?.state);
  const headSha = string(item?.headRefOid);
  const mergeStateStatus = string(item?.mergeStateStatus);
  const body = string(item?.body);
  if (
    !id || title === undefined || !headSha || body === undefined ||
    (state !== "OPEN" && state !== "MERGED" && state !== "CLOSED") ||
    !mergeStateStatus
  ) throw new TypeError("Pull request response is invalid.");
  if (
    autoMerge &&
    (typeof autoMerge.mergeMethod !== "string" || !enabledBy ||
      typeof enabledBy.login !== "string")
  ) throw new TypeError("Auto-merge response is invalid.");
  const exactAutoMerge = autoMerge && enabledBy
    ? {
      mergeMethod: autoMerge.mergeMethod as string,
      enabledBy: enabledBy.login as string,
    }
    : undefined;
  return {
    id,
    title,
    state,
    headSha,
    mergeStateStatus,
    ownership: parseReleaseOwnershipMarker(body),
    autoMerge: exactAutoMerge,
  };
}

function requirePullRequestCoordinates(
  item: Json | undefined,
  repository: string,
  branch: string,
): void {
  const headRepository = string(object(item?.headRepository)?.nameWithOwner);
  const baseRepository = string(object(item?.baseRepository)?.nameWithOwner);
  if (
    headRepository !== repository || baseRepository !== repository ||
    string(item?.headRefName) !== branch || string(item?.baseRefName) !== "main"
  ) {
    throw new TypeError("Pull request repository or branch is invalid.");
  }
}

function requireMutationPullRequest(
  data: Json,
  field: string,
  id: string,
): void {
  const result = object(data[field]);
  const pullRequest = object(result?.pullRequest);
  if (string(pullRequest?.id) !== id) {
    throw new TypeError("GitHub mutation response is invalid.");
  }
}

function checkRun(value: unknown): SyntheticCheckRun {
  const item = object(value);
  const app = object(item?.app);
  const id = item?.id;
  const name = item?.name;
  const headSha = item?.head_sha;
  const externalId = item?.external_id;
  const detailsUrl = item?.details_url;
  const status = item?.status;
  const conclusion = item?.conclusion;
  if (
    !item || typeof id !== "number" || !Number.isSafeInteger(id) || id < 1 ||
    typeof name !== "string" || typeof headSha !== "string" ||
    !(app === null ||
      (app && (app.id === null || Number.isSafeInteger(app.id)))) ||
    !(externalId === null || typeof externalId === "string") ||
    !(detailsUrl === null || typeof detailsUrl === "string") ||
    typeof status !== "string" ||
    !(conclusion === null || typeof conclusion === "string")
  ) throw new TypeError("Check run response is invalid.");
  return {
    id,
    name,
    headSha,
    integrationId: app === null || app.id === null ? null : app.id as number,
    externalId,
    detailsUrl,
    status,
    conclusion,
  };
}

function tagTarget(text: string, tag: string): string | undefined {
  if (!text) return undefined;
  let direct: string | undefined;
  for (const line of text.split("\n").filter(Boolean)) {
    const match =
      /^([0-9a-f]{40}(?:[0-9a-f]{24})?)\trefs\/tags\/([^\^]+)(\^\{\})?$/.exec(
        line,
      );
    if (!match || match[2] !== tag) {
      throw new TypeError("Tag response is invalid.");
    }
    if (match[3]) {
      throw new TypeError("Tag is annotated.");
    } else {
      if (direct) throw new TypeError("Tag response is ambiguous.");
      direct = match[1];
    }
  }
  if (!direct) throw new TypeError("Tag response is invalid.");
  return direct;
}

function jsonPages(text: string): Json[] {
  if (!text.trim()) throw new TypeError("Check-run response is empty.");
  const pages = array(parseJson(text));
  if (!pages) throw new TypeError("Check-run response is invalid.");
  return pages.map((page) =>
    object(page) ?? fail("Check-run page is invalid.")
  );
}
function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new TypeError("GitHub response is not JSON.");
  }
}
function graphqlMessage(value: unknown): string {
  const message = string(object(value)?.message);
  if (!message) throw new TypeError("GitHub GraphQL error is invalid.");
  return message;
}
function object(value: unknown): Json | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Json
    : undefined;
}
function array(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}
function string(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
function text(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}
function singleLine(value: string): string {
  if (!/^\S+\n$/.test(value)) throw new TypeError("Expected one line.");
  return value.slice(0, -1);
}
function requireSha(value: string): void {
  if (!shaPattern.test(value)) throw new TypeError("SHA is invalid.");
}
function requireTag(value: string): void {
  if (!parseSemver(value)) {
    throw new TypeError("Tag is invalid.");
  }
}
function requireBranch(value: string): void {
  const version = value.slice("release-".length);
  if (!parseSemver(version) || value !== `release-${version}`) {
    throw new TypeError("Release branch is invalid.");
  }
}
function requireRepository(value: Repository): void {
  if (
    !/^[A-Za-z0-9_.-]+$/.test(value.owner) ||
    !/^[A-Za-z0-9_.-]+$/.test(value.name)
  ) throw new TypeError("Repository is invalid.");
}
function fail(message: string): never {
  throw new TypeError(message);
}

const prQuery =
  `query($owner:String!,$name:String!,$branch:String!,$cursor:String){repository(owner:$owner,name:$name){pullRequests(first:100,after:$cursor,states:[OPEN],headRefName:$branch,baseRefName:"main"){nodes{id title state headRefName baseRefName headRefOid mergeStateStatus body headRepository{nameWithOwner} baseRepository{nameWithOwner} autoMergeRequest{mergeMethod enabledBy{login}}} pageInfo{hasNextPage endCursor}}}}`;
const pullRequestByIdQuery =
  `query($pullRequestId:ID!){node(id:$pullRequestId){... on PullRequest{id title state headRefName baseRefName headRefOid mergeStateStatus body headRepository{nameWithOwner} baseRepository{nameWithOwner} autoMergeRequest{mergeMethod enabledBy{login}}}}}`;
const mergedPrQuery =
  `query($owner:String!,$name:String!,$branch:String!,$cursor:String){repository(owner:$owner,name:$name){pullRequests(first:100,after:$cursor,states:[MERGED],headRefName:$branch,baseRefName:"main"){nodes{body headRefName baseRefName headRepository{nameWithOwner} baseRepository{nameWithOwner}} pageInfo{hasNextPage endCursor}}}}`;
const disableMutation =
  `mutation($pullRequestId:ID!){disablePullRequestAutoMerge(input:{pullRequestId:$pullRequestId}){pullRequest{id}}}`;
const enableMutation =
  `mutation($pullRequestId:ID!,$mergeMethod:PullRequestMergeMethod!,$expectedHeadOid:GitObjectID!){enablePullRequestAutoMerge(input:{pullRequestId:$pullRequestId,mergeMethod:$mergeMethod,expectedHeadOid:$expectedHeadOid}){pullRequest{id}}}`;
const closeMutation =
  `mutation($pullRequestId:ID!){closePullRequest(input:{pullRequestId:$pullRequestId}){pullRequest{id}}}`;
