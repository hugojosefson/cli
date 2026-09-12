/** Create an empty GitHub repository through explicit, bounded API requests. */
import {
  githubCommandFailure,
  type GithubCommandRunner,
  localGithubCommand,
} from "./github-command.ts";
import { json, object } from "./github-response.ts";

export type RepositoryVisibility = "public" | "private";
export interface GithubRepositoryTarget {
  readonly owner: string;
  readonly name: string;
  readonly visibility: RepositoryVisibility;
}
export interface GithubRepositorySetup {
  viewerLogin(): Promise<string>;
  /** Rejects an existing or unreadable target; never adopts another repository. */
  assertAbsent(target: GithubRepositoryTarget): Promise<void>;
  create(target: GithubRepositoryTarget): Promise<void>;
}

export class LocalGithubRepositorySetup implements GithubRepositorySetup {
  constructor(
    readonly runner: GithubCommandRunner,
  ) {}

  static at(root: URL): LocalGithubRepositorySetup {
    return new LocalGithubRepositorySetup(localGithubCommand(root));
  }

  async viewerLogin(): Promise<string> {
    const value = object(await this.#request("user"))?.login;
    if (typeof value !== "string" || !/^[A-Za-z0-9-]+$/.test(value)) {
      throw new Error("Cannot resolve the GitHub account. Run gh auth login.");
    }
    return value;
  }

  async assertAbsent(target: GithubRepositoryTarget): Promise<void> {
    const args = [
      "api",
      "--hostname",
      "github.com",
      `repos/${target.owner}/${target.name}`,
    ];
    let result;
    try {
      result = await this.runner.run(args);
    } catch {
      throw new Error(githubCommandFailure(args));
    }
    if (result.success) {
      throw new Error(
        `GitHub repository ${target.owner}/${target.name} already exists. Link it explicitly with git remote add origin https://github.com/${target.owner}/${target.name}.git, or choose --github-name=<name>.`,
      );
    }
    const response = object(json(result.stdout));
    if (response?.status !== "404" && response?.status !== 404) {
      throw new Error(githubCommandFailure(args, result));
    }
  }

  async create(target: GithubRepositoryTarget): Promise<void> {
    // Recheck immediately before the single POST; never retry uncertain writes.
    await this.assertAbsent(target);
    const login = await this.viewerLogin();
    const endpoint = login.toLowerCase() === target.owner.toLowerCase()
      ? "user/repos"
      : `orgs/${target.owner}/repos`;
    const response = object(
      await this.#request(endpoint, {
        name: target.name,
        private: target.visibility === "private",
        auto_init: false,
      }),
    );
    if (
      typeof response?.full_name !== "string" ||
      response.full_name.toLowerCase() !==
        `${target.owner}/${target.name}`.toLowerCase() ||
      response.private !== (target.visibility === "private")
    ) {
      throw new Error(
        "GitHub creation returned an unexpected repository. Inspect the account before retrying.",
      );
    }
  }

  async #request(
    endpoint: string,
    body?: Record<string, unknown>,
  ): Promise<unknown> {
    const args = [
      "api",
      "--hostname",
      "github.com",
      endpoint,
      ...(body ? ["--method", "POST", "--input", "-"] : []),
    ];
    let result;
    try {
      result = await this.runner.run(
        args,
        body ? JSON.stringify(body) : undefined,
      );
    } catch {
      throw new Error(githubCommandFailure(args));
    }
    if (!result.success) throw new Error(githubCommandFailure(args, result));
    return json(result.stdout);
  }
}
