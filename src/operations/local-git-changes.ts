/** @module Guarded local Git changes executed with fixed argument arrays. */
import { type CommandResult, runCommand } from "../runtime/command.ts";

import type { PlannedChange } from "../api/planned-change.ts";
import { LocalGitReader } from "../repository/local-git-reader.ts";
import type { RepositoryRoot } from "../repository/repository-path.ts";
import { ChangePlanError } from "./change-plan-error.ts";
import { containedUrl } from "./local-plan-state.ts";

type GitChange = Extract<
  PlannedChange,
  { readonly kind: `git-${string}` | "create-git-branch" | "set-git-remote" }
>;

export async function applyGitChange(
  root: RepositoryRoot,
  change: GitChange,
): Promise<void> {
  const reader = new LocalGitReader(root.url);
  if (change.kind === "git-init") {
    if (await reader.isRepository()) {
      throw new ChangePlanError("expected-state", change.kind);
    }
    return await git(root, [
      "init",
      ...(change.defaultBranch
        ? [`--initial-branch=${change.defaultBranch}`]
        : []),
    ]);
  }
  if (!await reader.isRepository()) {
    throw new ChangePlanError("expected-state", change.kind);
  }
  if (change.kind === "git-commit") {
    await Promise.all(change.paths.map((path) => containedUrl(root, path)));
    if (change.paths.length > 0) {
      await git(root, ["add", "-A", "--", ...change.paths]);
    }
    return await git(root, [
      "commit",
      "--only",
      "-m",
      change.message,
      ...(change.allowEmpty ? ["--allow-empty"] : []),
      "--",
      ...change.paths,
    ]);
  }
  if (change.kind === "create-git-branch") {
    if (
      (await result(root, [
        "show-ref",
        "--verify",
        "--quiet",
        `refs/heads/${change.name}`,
      ])).success
    ) throw new ChangePlanError("expected-state", change.name);
    return await git(root, [
      "branch",
      change.name,
      ...(change.startPoint ? [change.startPoint] : []),
    ]);
  }
  rejectAuthenticatedUrl(change.url);
  const output = await result(root, ["remote", "get-url", change.name]);
  const current = output.success
    ? new TextDecoder().decode(output.stdout).trim()
    : undefined;
  if (current !== change.expectedUrl) {
    throw new ChangePlanError("expected-state", change.name);
  }
  return await git(
    root,
    current === undefined
      ? ["remote", "add", change.name, change.url]
      : ["remote", "set-url", change.name, change.url],
  );
}

function rejectAuthenticatedUrl(value: string): void {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    return;
  }
  const url = new URL(value);
  if (url.username || url.password) {
    throw new ChangePlanError("expected-state", "authenticated remote URL");
  }
}

async function git(
  root: RepositoryRoot,
  args: readonly string[],
): Promise<void> {
  if (!(await result(root, args)).success) {
    throw new ChangePlanError("git", args[0]);
  }
}

function result(
  root: RepositoryRoot,
  args: readonly string[],
): Promise<CommandResult> {
  return runCommand("git", { args: [...args], cwd: root.path });
}
