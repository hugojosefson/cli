/** @module Concrete plan effects without printing file contents or secret values. */
import type { PlannedChange } from "../api/planned-change.ts";
import type { FileReader, GithubReader } from "../api/repository-context.ts";

import { describeConfiguration } from "./repair-configuration-description.ts";
import { describeFileRepair } from "./describe-file-repair.ts";

/** Describe effects, never serialize arbitrary file, command, URL or secret data. */
export async function describePlannedChange(
  change: PlannedChange,
  files: FileReader,
  github?: GithubReader,
): Promise<string> {
  switch (change.kind) {
    case "create-directory":
      return `Create directory ${change.path} if absent.`;
    case "write-file": {
      if (change.expectedDigest === undefined) {
        return [
          `Create ${change.path}${
            change.mode === undefined
              ? ""
              : ` with mode ${change.mode.toString(8)}`
          }.`,
          ...describeFileRepair(change.path, undefined, change.content),
        ].join("\n");
      }
      const before = await files.readText(change.path);
      if (before === undefined) {
        throw new Error("The planned file is no longer readable.");
      }
      return describeFileRepair(change.path, before, change.content).join("\n");
    }
    case "remove-file":
      return `Remove ${change.path}, including its current contents.`;
    case "remove-directory":
      return `Remove directory ${change.path} and its contents.`;
    case "create-symlink":
      return `Create symbolic link ${change.path} to ${change.target}.`;
    case "remove-symlink":
      return `Remove symbolic link ${change.path}.`;
    case "set-file-mode":
      return `Set ${change.path} permissions to ${change.mode.toString(8)}.`;
    case "set-json":
      return `Set ${change.path}: ${
        describeConfiguration(
          change.value,
          change.expected,
          change.jsonPath.join("."),
        ).join("; ")
      }${
        change.expected === undefined
          ? " (add value)"
          : " (replace existing value)"
      }.`;
    case "remove-json":
      return `Remove ${change.path} ${
        change.jsonPath.join(".")
      }, including its current value.`;
    case "git-init":
      return `Initialize .git${
        change.defaultBranch
          ? ` with default branch ${change.defaultBranch}`
          : ""
      }.`;
    case "git-commit":
      return `Commit ${change.paths.join(", ") || "an empty change"} in Git.`;
    case "create-git-branch":
      return `Create Git branch ${change.name}.`;
    case "set-git-remote":
      return `Set Git remote ${change.name} to the planned repository URL.`;
    case "upsert-github-resource": {
      const existing = change.expectedStateDigest !== undefined &&
          [
            "repository-setting",
            "actions-workflow-permission",
            "repository-ruleset",
          ].includes(change.resource)
        ? await github?.resource(change.resource, change.name)
        : undefined;
      return `${
        change.expectedStateDigest === undefined ? "Create" : "Update"
      } GitHub ${change.resource}/${change.name}: ${
        describeConfiguration(change.definition, existing?.definition).join(
          "; ",
        )
      }.`;
    }
    case "delete-github-resource":
      return `Delete GitHub ${change.resource}/${change.name}.`;
    case "github-ruleset-transition":
      return change.steps.map(({ change, before }) =>
        change.kind === "delete"
          ? `Delete GitHub ruleset ${change.name}.`
          : `Replace GitHub ruleset ${change.name}: ${
            describeConfiguration(
              change.definition,
              before.find((item) => item.name === change.name)?.definition,
            ).join("; ")
          }.`
      ).join("\n");
    case "app-setup":
      return `Configure GitHub app ${change.name} for ${change.repository}, environment ${change.environment}, secret ${change.secretName}; secret values are not displayed.`;
  }
}
