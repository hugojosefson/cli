/** Read the authenticated GitHub viewer through the shared command adapter. */
import type { GithubIdentityReader } from "../api/repository-context.ts";
import {
  type GithubCommandRunner,
  localGithubCommand,
} from "./github-command.ts";
import { json, object } from "./github-response.ts";

export class LocalGithubIdentityReader implements GithubIdentityReader {
  readonly #runner: GithubCommandRunner;
  constructor(
    root: URL,
    runner: GithubCommandRunner = localGithubCommand(root),
  ) {
    this.#runner = runner;
  }
  async viewer(): Promise<{ readonly name: string } | undefined> {
    try {
      const output = await this.#runner.run(["api", "user"]);
      const value = output.success
        ? object(json(output.stdout))?.name
        : undefined;
      const name = typeof value === "string" ? value.trim() : "";
      return name ? { name } : undefined;
    } catch {
      return undefined;
    }
  }
}
