import { assertEquals } from "@std/assert";
import type { GithubReader } from "../api/repository-context.ts";
import {
  requirePublisherQuiescence,
  requireTagQuiescence,
} from "./release-quiescence.ts";

const reader = (overrides: Partial<GithubReader>): GithubReader => ({
  repository: () => Promise.resolve(undefined),
  rulesets: () => Promise.resolve(undefined),
  environments: () => Promise.resolve([]),
  variables: () => Promise.resolve([]),
  secretExists: () => Promise.resolve(undefined),
  resource: () => Promise.resolve(undefined),
  workflowRuns: () => Promise.resolve([]),
  openPullRequests: () => Promise.resolve([]),
  branches: () => Promise.resolve([]),
  tags: () => Promise.resolve([]),
  defaultBranchCommits: () => Promise.resolve([]),
  ...overrides,
});

Deno.test("publisher quiescence accepts only completed runs", async () => {
  for (
    const status of [
      "queued",
      "in_progress",
      "waiting",
      "pending",
      "requested",
      "unknown",
    ]
  ) {
    assertEquals(
      typeof await requirePublisherQuiescence(
        reader({ workflowRuns: () => Promise.resolve([{ status }]) }),
        ["a"],
      ),
      "string",
    );
  }
  assertEquals(await requirePublisherQuiescence(reader({}), ["a"]), undefined);
});

Deno.test("tag quiescence rejects release collisions and unavailable data", async () => {
  const cases: Partial<GithubReader>[] = [
    { workflowRuns: () => Promise.resolve([{ status: "queued" }]) },
    {
      openPullRequests: () =>
        Promise.resolve([{ head: "release-1.0.0", title: "x" }]),
    },
    { branches: () => Promise.resolve([{ name: "release-1.0.0" }]) },
    {
      defaultBranchCommits: () =>
        Promise.resolve([{ oid: "a", subject: "chore(release): 1.0.0" }]),
    },
    { tags: () => Promise.resolve(undefined) },
  ];
  for (const item of cases) {
    assertEquals(
      typeof await requireTagQuiescence(reader(item), "tag"),
      "string",
    );
  }
  assertEquals(
    await requireTagQuiescence(
      reader({
        tags: () =>
          Promise.resolve([{ name: "1.0.0", target: "a", lightweight: true }]),
        defaultBranchCommits: () =>
          Promise.resolve([{ oid: "a", subject: "chore(release): 1.0.0" }]),
      }),
      "tag",
    ),
    undefined,
  );
});

Deno.test("tag quiescence requires complete lifecycle reads", async () => {
  for (
    const key of [
      "workflowRuns",
      "openPullRequests",
      "branches",
      "tags",
      "defaultBranchCommits",
    ] as const
  ) {
    assertEquals(
      await requireTagQuiescence(
        reader({ [key]: () => Promise.resolve(undefined) }),
        "tag",
      ),
      "Release lifecycle data is unavailable.",
    );
  }
  for (
    const status of [
      "queued",
      "in_progress",
      "waiting",
      "pending",
      "requested",
      "unknown",
    ]
  ) {
    assertEquals(
      await requireTagQuiescence(
        reader({ workflowRuns: () => Promise.resolve([{ status }]) }),
        "tag",
      ),
      "Tag workflow is not quiescent.",
    );
  }
});

Deno.test("tag quiescence reserves release pull requests and branches", async () => {
  assertEquals(
    await requireTagQuiescence(
      reader({
        openPullRequests: () =>
          Promise.resolve([{ head: "release-1.0.0", title: "custom" }]),
      }),
      "tag",
    ),
    "An open reserved release pull request remains.",
  );
  assertEquals(
    await requireTagQuiescence(
      reader({
        branches: () => Promise.resolve([{ name: "release-1.0.0-fix" }]),
      }),
      "tag",
    ),
    "A reserved release branch remains.",
  );
});

Deno.test("tag quiescence requires one correct lightweight release tag", async () => {
  const commit = { oid: "a", subject: "chore(release): 1.0.0" };
  const check = (
    tags: readonly { name: string; target: string; lightweight: boolean }[],
  ) =>
    requireTagQuiescence(
      reader({
        tags: () => Promise.resolve(tags),
        defaultBranchCommits: () => Promise.resolve([commit]),
      }),
      "tag",
    );
  assertEquals(
    await check([{ name: "1.0.0", target: "a", lightweight: true }]),
    undefined,
  );
  for (
    const tags of [
      [],
      [{ name: "1.0.0", target: "b", lightweight: true }],
      [{ name: "1.0.0", target: "a", lightweight: false }],
      [
        { name: "1.0.0", target: "a", lightweight: true },
        { name: "1.0.0", target: "a", lightweight: true },
      ],
    ]
  ) {
    assertEquals(
      await check(tags),
      tags.length > 1
        ? "Release tags are ambiguous."
        : "Release commit 1.0.0 has no correct lightweight tag.",
    );
  }
});
