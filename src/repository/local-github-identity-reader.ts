/** @module Bounded local Github viewer reader. */

import type { GithubIdentityReader } from "../api/repository-context.ts";

/** Reads the authenticated Github display name without exposing credentials. */
export class LocalGithubIdentityReader implements GithubIdentityReader {
  async viewer(): Promise<{ readonly name: string } | undefined> {
    try {
      const output = await new Deno.Command("gh", {
        args: ["api", "user", "--jq", ".name"],
      }).output();
      const name = output.success
        ? new TextDecoder().decode(output.stdout).trim()
        : "";
      return name ? { name } : undefined;
    } catch {
      return undefined;
    }
  }
}
