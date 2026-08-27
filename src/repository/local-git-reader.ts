/** @module Local read-only implementation of the Git reader contract. */

import type { RepositoryPath } from "../api/json.ts";
import type {
  GitHead,
  GitReader,
  GitRemote,
  GitStatus,
} from "../api/repository-context.ts";
import {
  type RepositoryRoot,
  repositoryRoot,
  repositoryUrl,
} from "./repository-path.ts";

/** Reads Git state by running Git with fixed argument arrays. */
export class LocalGitReader implements GitReader {
  readonly #root: RepositoryRoot;

  constructor(root: URL) {
    this.#root = repositoryRoot(root);
  }

  async isRepository(): Promise<boolean> {
    const result = await this.#git(["rev-parse", "--is-inside-work-tree"]);
    return result.success && text(result.stdout).trim() === "true";
  }

  async head(): Promise<GitHead | undefined> {
    if (!await this.isRepository()) {
      return undefined;
    }
    const commit = await this.#git(["rev-parse", "--verify", "HEAD"]);
    if (!commit.success) {
      return undefined;
    }
    const branch = await this.#git([
      "symbolic-ref",
      "--quiet",
      "--short",
      "HEAD",
    ]);
    const name = branch.success ? text(branch.stdout).trim() : undefined;
    return {
      commit: text(commit.stdout).trim(),
      ...(name ? { branch: name } : {}),
    };
  }

  async status(
    paths?: readonly RepositoryPath[],
    options?: { readonly includeIgnored?: boolean },
  ): Promise<GitStatus | undefined> {
    if (!await this.isRepository()) {
      return undefined;
    }
    const arguments_ = ["status", "--porcelain=v1", "-z"];
    if (options?.includeIgnored) {
      arguments_.push("--ignored=matching", "--untracked-files=all");
    }
    if (paths && paths.length > 0) {
      for (const path of paths) {
        repositoryUrl(this.#root, path);
      }
      arguments_.push("--", ...paths);
    }
    const result = await this.#git(arguments_);
    if (!result.success) {
      return undefined;
    }
    const changedPaths = parseStatus(result.stdout);
    return { isClean: changedPaths.length === 0, changedPaths };
  }

  async remotes(): Promise<readonly GitRemote[]> {
    if (!await this.isRepository()) {
      return [];
    }
    const names = await this.#git(["remote"]);
    if (!names.success) {
      return [];
    }
    const remotes: GitRemote[] = [];
    for (
      const name of text(names.stdout).split("\n").filter(Boolean).sort(
        compareText,
      )
    ) {
      const result = await this.#git(["remote", "get-url", name]);
      if (result.success) {
        remotes.push({ name, url: text(result.stdout).trimEnd() });
      }
    }
    return remotes;
  }

  async defaultBranch(): Promise<string | undefined> {
    if (!await this.isRepository()) {
      return undefined;
    }
    const remotes = await this.remotes();
    const ordered = [...remotes].sort((left, right) => {
      if (left.name === "origin") return -1;
      if (right.name === "origin") return 1;
      return compareText(left.name, right.name);
    });
    for (const remote of ordered) {
      const result = await this.#git([
        "symbolic-ref",
        "--quiet",
        "--short",
        `refs/remotes/${remote.name}/HEAD`,
      ]);
      if (result.success) {
        const reference = text(result.stdout).trim();
        const prefix = `${remote.name}/`;
        if (reference.startsWith(prefix)) {
          return reference.slice(prefix.length);
        }
      }
    }
    return undefined;
  }

  #git(args: readonly string[]): Promise<Deno.CommandOutput> {
    return new Deno.Command("git", { args: [...args], cwd: this.#root.path })
      .output();
  }
}

function parseStatus(output: Uint8Array): readonly RepositoryPath[] {
  const records = new TextDecoder().decode(output).split("\0");
  const paths = new Set<RepositoryPath>();
  for (let index = 0; index < records.length - 1; index++) {
    const record = records[index];
    if (record.length < 4) {
      continue;
    }
    const status = record.slice(0, 2);
    const path = record.slice(3);
    addPath(paths, path);
    if (status.includes("R") || status.includes("C")) {
      addPath(paths, records[++index]);
    }
  }
  return [...paths].sort(compareText);
}

function addPath(paths: Set<RepositoryPath>, path: string | undefined): void {
  if (path && !path.startsWith("/") && !path.split("/").includes("..")) {
    paths.add(path);
  }
}

function text(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
