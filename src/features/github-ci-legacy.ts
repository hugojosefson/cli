/** @module Exact git-hj-init CI recognition and preserved required check names. */

import type { DetectionContext } from "../api/repository-context.ts";
import { inspectArtifact } from "../artifacts/inspect-artifact.ts";

// git-hj-init interpolated action major versions. All other bytes must match.
export const legacyGithubCiArtifacts = [
  {
    path: ".github/workflows/deno.yaml",
    content: `name: deno

on:
  pull_request:
  push:
    branches-ignore:
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
`,
  },
  {
    path: ".github/workflows/bump-deps.yaml",
    content: `name: bump-deps

on:
  workflow_dispatch:
  schedule:
    - cron: "0 0 * * *" # midnight UTC

jobs:
  molt:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: hasundue/molt-action@v1
`,
  },
] as const;

export async function inspectLegacyGithubCi(context: DetectionContext) {
  return await Promise.all(legacyGithubCiArtifacts.map(async (artifact) => {
    const observation = await context.files.observe(artifact.path);
    const recorded = observation.kind === "file" ? observation.content : "";
    let content: string = artifact.content;
    for (
      const action of [
        "actions/checkout",
        "denoland/setup-deno",
        "hasundue/molt-action",
      ]
    ) {
      const reference = recorded.match(
        new RegExp(`uses: ${action}@(v[1-9][0-9]*)\\n`),
      )?.[1];
      if (reference) {
        content = content.replaceAll(
          new RegExp(`${action}@v[0-9]+`, "g"),
          `${action}@${reference}`,
        );
      }
    }
    return inspectArtifact(
      { kind: "file", path: artifact.path, content, mode: 0o644 },
      observation.kind === "file"
        ? { ...observation, mode: 0o644 }
        : observation,
    );
  }));
}

/** Preserve the old test check without running the test suite twice. */
export const legacyCiCheckCompatibility =
  `  # Retains the git-hj-init required test check.
  test:
    needs: check
    if: \${{ always() }}
    runs-on: ubuntu-latest
    steps:
      - name: Report the test result from check
        env:
          HJ_CHECK_RESULT: \${{ needs.check.result }}
        run: test "$HJ_CHECK_RESULT" = "success"
`;
