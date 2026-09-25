/** @module Explicit local artifact boundaries for feature overwrite. */
import {
  denoCliArtifacts,
  denoCliServeArtifact,
} from "../features/deno-cli-artifacts.ts";
import { denoLibArtifacts } from "../features/deno-lib-artifacts.ts";
import { denoServerArtifacts } from "../features/deno-server-artifacts.ts";
import {
  publishGithubArtifact,
  publishJsrArtifact,
  publishNpmArtifact,
  publishTagArtifact,
} from "../features/github-release-publish-artifacts.ts";

export type OverwriteArtifacts = {
  readonly files: readonly string[];
  readonly config?: readonly (readonly string[])[];
};
const tasks = (...names: string[]) => names.map((name) => ["tasks", name]);
const artifacts: Readonly<Record<string, OverwriteArtifacts>> = {
  git: { files: [] },
  changelog: { files: ["CHANGELOG.md"] },
  editorconfig: { files: [".editorconfig", ".hj/editorconfig.json"] },
  "git-ignore": { files: [".gitignore"] },
  "deno-fmt": {
    files: [".hj/deno-lock.json"],
    config: tasks("fmt", "format", "check", "default", "all"),
  },
  "deno-lint": { files: [], config: tasks("lint", "check") },
  "deno-typecheck": { files: [], config: tasks("typecheck", "check") },
  "deno-test": {
    files: [],
    config: tasks("test", "coverage", "dev:test", "check"),
  },
  "deno-lib": {
    files: denoLibArtifacts.map((item) => item.path),
    config: [["exports", "."], ["imports", "@std/assert"]],
  },
  "deno-cli": {
    files: [
      ...denoCliArtifacts.map((item) => item.path),
      "src/cli/package-metadata.json",
      denoCliServeArtifact.path,
    ],
    config: [["exports", "./cli"], ...tasks("package-metadata")],
  },
  "deno-server": {
    files: [
      ...denoServerArtifacts.map((item) => item.path),
      "src/server/serve-command.ts",
    ],
    config: [["exports", "./server"], ...tasks("serve", "dev")],
  },
  "readme-static": { files: ["README.md", ".hj/readme.json"] },
  "readme-build": {
    files: ["README.md", "readme/README.md", ".hj/readme.json"],
    config: tasks("readme", "default"),
  },
  "deno-config-version": { files: [], config: [] },
  "jsr-package": { files: [], config: tasks("publish-check", "check") },
  "github-ci": {
    files: [
      ".github/workflows/hj-ci.yaml",
      ".github/workflows/hj-deps.yaml",
      ".github/workflows/deno.yaml",
      ".github/workflows/bump-deps.yaml",
    ],
  },
  "github-release-publish-tag": { files: [publishTagArtifact.path] },
  "github-release-publish-jsr": {
    files: [
      publishJsrArtifact.path,
      ".github/workflows/hj-release.yaml",
      ".github/workflows/release.yaml",
    ],
    config: tasks("bump-version", "release", "release-commit"),
  },
  "github-release-publish-github": { files: [publishGithubArtifact.path] },
  "github-release-publish-npm": { files: [publishNpmArtifact.path] },
};

export function overwriteArtifacts(id: string): OverwriteArtifacts | undefined {
  return id.startsWith("license-") ? { files: ["LICENSE"] } : artifacts[id];
}
