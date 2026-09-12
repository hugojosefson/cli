/** Resolve and display repository creation before making any external changes. */
import { runCommand } from "../runtime/command.ts";
import { makeTempFile } from "../runtime/temp.ts";
import * as fs from "node:fs/promises";
import { basename, fromFileUrl } from "@std/path";
import type { FeatureChangeRequest } from "../api/feature-change.ts";
import { LocalGitReader } from "../repository/local-git-reader.ts";
import type {
  GithubRepositorySetup,
  RepositoryVisibility,
} from "../repository/github-repository-setup.ts";
import { FeatureCommitSession } from "./git-feature-commit.ts";
import type { GithubSetupArguments } from "./parse-features.ts";

export type VisibilityPrompt = () => string | null;
export function promptGithubVisibility(): string | null {
  return Deno.stdin.isTerminal()
    ? globalThis.prompt("GitHub repository visibility (public or private)")
    : null;
}

export async function setupGithubRepository(
  root: URL,
  args: GithubSetupArguments & { readonly confirmation: boolean },
  request: FeatureChangeRequest,
  setup: GithubRepositorySetup,
  prompt: VisibilityPrompt,
  report: (plan: string) => void,
): Promise<string> {
  if (
    request.changes.some((change) =>
      change.featureId === "git" && !change.enabled
    )
  ) {
    throw new Error(
      "GitHub repository linking requires Git. Remove --no-git and retry.",
    );
  }
  const git = new LocalGitReader(root);
  if ((await git.remotes()).length) {
    throw new Error(
      "An existing Git remote cannot be read as a GitHub repository. Check gh auth status and the remote; hj will not replace it.",
    );
  }
  const explicit = request.changes.find((change) =>
    change.featureId === "github-private"
  );
  const visibility = explicit
    ? (explicit.enabled ? "private" : "public")
    : request.presets.includes("github-public")
    ? "public"
    : request.presets.includes("github")
    ? "private"
    : args.defaultGithubVisibility ??
      (args.confirmation ? undefined : prompt()?.trim());
  if (visibility !== "public" && visibility !== "private") {
    throw new Error(
      "GitHub visibility is unresolved. Supply --github-private or --github-public, or set hj config set github-visibility public (or private). --yes does not select visibility.",
    );
  }
  const owner = args.githubOwner ?? await setup.viewerLogin();
  const name = args.githubName ?? basename(fromFileUrl(root));
  if (
    !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(owner) ||
    !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name) || name.length > 100
  ) {
    throw new Error(
      "Supply a valid --github-owner=<owner> and --github-name=<name>.",
    );
  }
  const target = {
    owner,
    name,
    visibility: visibility as RepositoryVisibility,
  };
  const remote = `https://github.com/${owner}/${name}.git`;
  const existed = await git.isRepository();
  const summary =
    `Create GitHub repository ${owner}/${name}\nOwner: ${owner}\nName: ${name}\nVisibility: ${visibility}\nGit: ${
      existed ? "keep existing repository" : "initialize repository"
    }\nRemote: add origin ${remote}`;
  report(summary);
  if (!args.confirmation) {
    throw new Error(
      `${summary}\nConfirmation required. Rerun with --yes and the same visibility.`,
    );
  }
  const commits = !existed
    ? await FeatureCommitSession.prepare(root, [{
      featureId: "git",
      action: "enable",
      summary: "Initialize Git before linking GitHub.",
      changes: [{ kind: "git-init" }],
      preconditions: [],
      warnings: [],
      validations: [],
    }])
    : undefined;
  await setup.assertAbsent(target);
  // Check local write access before creating the external repository.
  const probe = await makeTempFile({
    dir: fromFileUrl(root),
    prefix: ".hj-setup-",
  });
  await fs.rm(probe);
  if ((await git.remotes()).length) {
    throw new Error("Git remotes changed after planning. Retry setup.");
  }
  try {
    await setup.create(target);
  } catch (cause) {
    throw new Error(
      `GitHub creation of ${owner}/${name} failed or is unconfirmed. Inspect that repository before retrying. ${
        cause instanceof Error ? cause.message : ""
      }`,
      { cause },
    );
  }
  try {
    if (!existed) {
      await runGit(root, ["init", "--initial-branch=main"]);
      await commits?.initialize();
    }
    if ((await git.remotes()).length) {
      throw new Error("Git remotes changed after creation.");
    }
    await runGit(root, ["remote", "add", "origin", remote]);
    const configured = await runCommand("git", {
      cwd: root,
      args: ["config", "--local", "--get", "remote.origin.url"],
      stdout: "piped",
      stderr: "piped",
    });
    if (
      !configured.success ||
      new TextDecoder().decode(configured.stdout).trim() !== remote
    ) throw new Error("Origin verification failed.");
  } catch (cause) {
    throw new Error(
      `Created ${owner}/${name}, but linking failed. Keep the repository and link it with git remote add origin ${remote}.`,
      { cause },
    );
  }
  return `Created and linked GitHub repository ${owner}/${name} (${visibility}).`;
}

async function runGit(root: URL, args: string[]): Promise<void> {
  const result = await runCommand("git", {
    cwd: root,
    args,
    stdout: "piped",
    stderr: "piped",
  });
  if (!result.success) {
    throw new Error(`Git ${args[0]} failed (exit ${result.code}).`);
  }
}
