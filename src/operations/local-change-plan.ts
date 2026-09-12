/** @module Bounded local verifier and applicator for feature change plans. */

import {
  findNodeAtLocation,
  getNodeValue,
  type ParseError,
  parseTree,
} from "jsonc-parser";
import type { ChangePlan, Precondition } from "../api/change-plan.ts";
import type { PlannedChange } from "../api/planned-change.ts";
import { LocalFileReader } from "../repository/local-file-reader.ts";
import { LocalGitReader } from "../repository/local-git-reader.ts";
import {
  type RepositoryRoot,
  repositoryRoot,
} from "../repository/repository-path.ts";
import { ChangePlanError } from "./change-plan-error.ts";
import { applyFileChange } from "./local-file-changes.ts";
import { applyGitChange } from "./local-git-changes.ts";
import { containedUrl, sameJson } from "./local-plan-state.ts";

/** Verifies preconditions and applies ordered local changes, not validations. */
export async function applyLocalChangePlan(
  rootUrl: URL,
  plan: ChangePlan,
): Promise<void> {
  await preflightLocalChangePlan(rootUrl, plan);
  const root = repositoryRoot(rootUrl);
  for (const change of plan.changes) await apply(root, change);
}

/** Verifies a local plan without changing the repository. */
export async function preflightLocalChangePlan(
  rootUrl: URL,
  plan: ChangePlan,
): Promise<void> {
  const root = repositoryRoot(rootUrl);
  rejectRemoteWork(plan);
  await Promise.all(plan.changes.map((change) => validateChange(root, change)));
  await Promise.all(plan.preconditions.map((item) => verify(root, item)));
}

function rejectRemoteWork(plan: ChangePlan): void {
  const remotePrecondition = plan.preconditions.some((item) =>
    item.kind === "github-resource-state" || item.kind === "github-remote-file"
  );
  const remoteChange = plan.changes.some((item) =>
    item.kind === "upsert-github-resource" ||
    item.kind === "delete-github-resource" || item.kind === "app-setup"
  );
  if (remotePrecondition || remoteChange) {
    throw new ChangePlanError("unsupported", "remote change");
  }
}

async function validateChange(
  root: RepositoryRoot,
  change: PlannedChange,
): Promise<void> {
  if ("path" in change) return void await containedUrl(root, change.path);
  if (change.kind === "git-commit") {
    await Promise.all(change.paths.map((path) => containedUrl(root, path)));
  }
  if (change.kind === "git-init" && change.defaultBranch?.startsWith("-")) {
    throw new ChangePlanError("expected-state", change.kind);
  }
  if (
    (change.kind === "create-git-branch" || change.kind === "set-git-remote") &&
    change.name.startsWith("-")
  ) throw new ChangePlanError("expected-state", change.name);
  if (
    change.kind === "create-git-branch" && change.startPoint?.startsWith("-")
  ) throw new ChangePlanError("expected-state", change.kind);
  if (change.kind === "set-git-remote" && change.url.startsWith("-")) {
    throw new ChangePlanError("expected-state", change.kind);
  }
}

async function verify(
  root: RepositoryRoot,
  condition: Precondition,
): Promise<void> {
  const files = new LocalFileReader(root.url, false);
  const git = new LocalGitReader(root.url);
  let matches = false;
  if (condition.kind === "file-digest") {
    const observed = await files.observe(condition.path);
    matches = condition.digest === undefined
      ? observed.kind === "absent"
      : observed.kind === "file" && observed.digest === condition.digest;
  }
  if (condition.kind === "json-value") {
    const text = await files.readText(condition.path);
    const errors: ParseError[] = [];
    const tree = text === undefined ? undefined : parseTree(text, errors, {
      allowTrailingComma: true,
      disallowComments: false,
    });
    const node = tree
      ? findNodeAtLocation(tree, [...condition.jsonPath])
      : undefined;
    matches = tree !== undefined && errors.length === 0 &&
      sameJson(node ? getNodeValue(node) : undefined, condition.expected);
  }
  if (condition.kind === "directory-state") {
    const observed = await files.observe(condition.path);
    matches = condition.digest === undefined
      ? observed.kind === "absent"
      : observed.kind === "directory" &&
        observed.stateDigest === condition.digest;
  }
  if (condition.kind === "git-repository") {
    matches = await git.isRepository() === condition.exists;
  }
  if (condition.kind === "git-head") {
    matches = (await git.head())?.commit === condition.commit;
  }
  if (condition.kind === "clean-worktree") {
    matches = (await git.status())?.isClean === true;
  }
  if (!matches) throw new ChangePlanError("precondition", condition.kind);
}

async function apply(
  root: RepositoryRoot,
  change: PlannedChange,
): Promise<void> {
  if (
    change.kind === "git-init" || change.kind === "git-commit" ||
    change.kind === "create-git-branch" || change.kind === "set-git-remote"
  ) return await applyGitChange(root, change);
  if (
    change.kind === "upsert-github-resource" ||
    change.kind === "delete-github-resource" ||
    change.kind === "github-ruleset-transition" || change.kind === "app-setup"
  ) throw new ChangePlanError("unsupported", change.kind);
  return await applyFileChange(root, change);
}
