/** @module Exact git-hj-init release bundle inspection. */

import type { DetectionContext } from "../api/repository-context.ts";
import { inspectArtifact } from "../artifacts/inspect-artifact.ts";
import { inspectDenoConfig } from "./deno-config.ts";
import { isObject } from "./deno-tasks.ts";
import { parseSemver } from "../release/semver.ts";

export const legacyReleaseArtifact = {
  path: ".github/workflows/release.yaml",
  content: `name: release

on:
  push:
    branches:
      - main

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: denoland/setup-deno@v2
      - run: deno task test
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: denoland/setup-deno@v2
      - run: deno fmt --check
      - run: deno lint
      - run: deno check

  publish:
    runs-on: ubuntu-latest
    needs: [test, check]

    permissions:
      contents: write
      id-token: write

    steps:
      - uses: actions/checkout@v4
      - uses: denoland/setup-deno@v2

      - name: Configure git
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

      - name: Release a new version
        run: deno task release:run

      - name: Publish the new version
        run: deno publish
`,
} as const;

export function legacyReleaseTasks(version: string) {
  return {
    "git-is-clean": '  test -z "$(git status --porcelain)"',
    "version":
      `       deno --allow-all npm:fork-version@${version} --inspect-version`,
    "release":
      "       echo 'ERROR: Not usually a good idea to do the release locally. Instead, push the main branch, and let the release workflow perform the actual release.'; exit 2",
    "release:run":
      "   deno task release:ready && deno task release:commit && deno task release:tag && deno task release:push",
    "release:ready":
      " deno task git-is-clean && deno task default && deno task git-is-clean",
    "release:commit":
      `deno --allow-all npm:fork-version@${version} --changelog-all --tag-prefix='' --skip-tag && deno fmt CHANGELOG.md && git add CHANGELOG.md && git commit --amend --no-edit`,
    "release:tag": "   git tag $(deno task version)",
    "release:push": "  git push origin main $(deno task version)",
  };
}

export async function inspectLegacyReleaseWorkflow(context: DetectionContext) {
  const observation = await context.files.observe(legacyReleaseArtifact.path);
  let content: string = legacyReleaseArtifact.content;
  for (const action of ["actions/checkout", "denoland/setup-deno"]) {
    const version = observation.kind === "file"
      ? observation.content.match(
        new RegExp(`uses: ${action}@(v[1-9][0-9]*)\\n`),
      )?.[1]
      : undefined;
    if (version) {
      content = content.replaceAll(
        new RegExp(`${action}@v[0-9]+`, "g"),
        `${action}@${version}`,
      );
    }
  }
  return inspectArtifact(
    { kind: "file", path: legacyReleaseArtifact.path, content, mode: 0o644 },
    observation.kind === "file"
      ? { ...observation, mode: 0o644, access: undefined }
      : observation,
  );
}

export async function inspectLegacyRelease(context: DetectionContext) {
  const workflow = await inspectLegacyReleaseWorkflow(context);
  const config = await inspectDenoConfig(context);
  const tasks = config.kind === "config" && isObject(config.value.tasks)
    ? config.value.tasks
    : {};
  const entries = Object.entries(tasks).filter(([name]) =>
    name === "release" || name === "version" || name === "git-is-clean" ||
    name.startsWith("release:")
  );
  if (
    workflow.result === "absent" &&
    !entries.some(([name]) => name === "release" || name.startsWith("release:"))
  ) return { kind: "absent" as const, workflow, config, entries };
  const version = typeof tasks.version === "string"
    ? tasks.version.match(
      /^ *deno --allow-all npm:fork-version@([^ ]+) --inspect-version$/,
    )?.[1]
    : undefined;
  const expected = legacyReleaseTasks(version ?? "");
  const referenced = Object.entries(tasks).some(([name, value]) =>
    !(name in expected) &&
    Object.keys(expected).some((legacyName) =>
      typeof value === "string"
        ? new RegExp(`\\bdeno task ${legacyName}(?:$|[ \\t;&|])`).test(value)
        : isObject(value) &&
          ((typeof value.command === "string" &&
            new RegExp(`\\bdeno task ${legacyName}(?:$|[ \\t;&|])`).test(
              value.command,
            )) ||
            Array.isArray(value.dependencies) &&
              value.dependencies.includes(legacyName))
    )
  );
  const exact = !referenced && version && parseSemver(version) &&
    entries.length === Object.keys(expected).length &&
    entries.every(([name, value]) =>
      typeof value === "string" &&
      value.trimStart() === expected[name as keyof typeof expected]?.trimStart()
    );
  return {
    kind: workflow.result === "matches" && exact
      ? "exact" as const
      : "custom" as const,
    workflow,
    config,
    entries,
  };
}
