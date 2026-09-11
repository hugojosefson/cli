import type { GithubCommandRunner } from "./github-command.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { LocalGithubClient } from "./local-github-client.ts";
import { mainProtectionDefinition } from "../features/github-protection-definitions.ts";

Deno.test("LocalGithubClient authenticates, reads, and atomically patches settings", async () => {
  const runner = new FakeRunner([
    json({ login: "octo" }),
    json({ nameWithOwner: "owner/repo", defaultBranchRef: { name: "main" } }),
    json({ has_issues: false, has_wiki: true }),
    json({ has_issues: false, has_wiki: true }),
    json({ has_issues: false, has_wiki: true }),
    json({}),
  ]);
  const client = new LocalGithubClient(
    new URL("file:///tmp/opencode/"),
    runner,
  );
  const issues = await client.resource("repository-setting", "has_issues");
  const wiki = await client.resource("repository-setting", "has_wiki");
  await client.upsertResources([
    {
      resource: "repository-setting",
      name: "has_issues",
      definition: { value: true },
      expectedStateDigest: issues!.stateDigest,
    },
    {
      resource: "repository-setting",
      name: "has_wiki",
      definition: { value: false },
      expectedStateDigest: wiki!.stateDigest,
    },
  ]);
  assertEquals(runner.calls, [
    { args: ["api", "user"] },
    { args: ["repo", "view", "--json", "nameWithOwner,defaultBranchRef"] },
    { args: ["api", "repos/owner/repo"] },
    { args: ["api", "repos/owner/repo"] },
    { args: ["api", "repos/owner/repo"] },
    {
      args: ["api", "--method", "PATCH", "repos/owner/repo", "--input", "-"],
      stdin: JSON.stringify({ has_issues: true, has_wiki: false }),
    },
  ]);
});

Deno.test("LocalGithubClient fails closed for malformed authentication and stale settings", async () => {
  const malformed = new LocalGithubClient(
    new URL("file:///tmp/opencode/"),
    new FakeRunner([
      new TextEncoder().encode("{}"),
    ]),
  );
  assertEquals(await malformed.repository(), undefined);
  const runner = new FakeRunner([
    json({ login: "octo" }),
    json({ nameWithOwner: "owner/repo" }),
    json({ has_issues: false }),
    json({ has_issues: true }),
  ]);
  const client = new LocalGithubClient(
    new URL("file:///tmp/opencode/"),
    runner,
  );
  const observed = await client.resource("repository-setting", "has_issues");
  await assertRejects(() =>
    client.upsertResources([{
      resource: "repository-setting",
      name: "has_issues",
      definition: { value: true },
      expectedStateDigest: observed!.stateDigest,
    }])
  );
  assertEquals(runner.calls.length, 4);
});

Deno.test("LocalGithubClient treats failing repository commands and missing fields as unavailable", async () => {
  const failing = new LocalGithubClient(
    new URL("file:///tmp/opencode/"),
    new FakeRunner([
      json({ login: "octo" }),
      undefined,
    ]),
  );
  assertEquals(await failing.repository(), undefined);
  const missing = new LocalGithubClient(
    new URL("file:///tmp/opencode/"),
    new FakeRunner([
      json({ login: "octo" }),
      json({ nameWithOwner: "owner/repo" }),
      json({}),
    ]),
  );
  assertEquals(
    await missing.resource("repository-setting", "has_issues"),
    undefined,
  );
});

Deno.test("LocalGithubClient models tag-ruleset eligibility fail closed", async () => {
  const eligible = async (repository: object, owner: object) => {
    const client = new LocalGithubClient(
      new URL("file:///tmp/opencode/"),
      new FakeRunner([
        json({ login: "octo" }),
        json({ nameWithOwner: "owner/repo" }),
        json(repository),
        json(owner),
      ]),
    );
    return await client.tagRulesetEligibility();
  };
  assertEquals(await eligible({ visibility: "public" }, {}), "eligible");
  assertEquals(
    await eligible({
      visibility: "private",
      owner: { type: "User", login: "octo" },
    }, { plan: { name: "pro" } }),
    "eligible",
  );
  assertEquals(
    await eligible({
      visibility: "private",
      owner: { type: "User", login: "octo" },
    }, { plan: { name: "free" } }),
    "ineligible",
  );
  assertEquals(
    await eligible({
      visibility: "private",
      owner: { type: "Organization", login: "org" },
    }, { plan: { name: "team" } }),
    "eligible",
  );
  assertEquals(
    await eligible({
      visibility: "internal",
      owner: { type: "Organization", login: "org" },
    }, { plan: { name: "enterprise" } }),
    "eligible",
  );
  assertEquals(
    await eligible({
      visibility: "internal",
      owner: { type: "Organization", login: "org" },
    }, { plan: { name: "team" } }),
    "ineligible",
  );
  assertEquals(
    await eligible({
      visibility: "private",
      owner: { type: "User", login: "octo" },
    }, {}),
    undefined,
  );
});

Deno.test("LocalGithubClient reads Actions pull-request permission and fails closed", async () => {
  const runner = new FakeRunner([
    json({ login: "octo" }),
    json({ nameWithOwner: "owner/repo" }),
    json({ can_approve_pull_request_reviews: true }),
  ]);
  const client = new LocalGithubClient(
    new URL("file:///tmp/opencode/"),
    runner,
  );
  assertEquals(
    (await client.resource(
      "actions-workflow-permission",
      "can-approve-pull-request-reviews",
    ))?.definition,
    { value: true },
  );
  assertEquals(runner.calls[2], {
    args: ["api", "repos/owner/repo/actions/permissions/workflow"],
  });
  const malformed = new LocalGithubClient(
    new URL("file:///tmp/opencode/"),
    new FakeRunner([
      json({ login: "octo" }),
      json({ nameWithOwner: "owner/repo" }),
      json({ can_approve_pull_request_reviews: "true" }),
    ]),
  );
  assertEquals(
    await malformed.resource(
      "actions-workflow-permission",
      "can-approve-pull-request-reviews",
    ),
    undefined,
  );
});

Deno.test("LocalGithubClient reads remote default-branch files without a checkout", async () => {
  const present = githubRunner([json({
    data: {
      repository: { object: { isBinary: false, text: "workflow\n" } },
    },
  })]);
  assertEquals(
    await githubClient(present).remoteFile(".github/workflows/hj-ci.yaml"),
    { kind: "file", content: "workflow\n" },
  );
  const args = present.calls.at(-1)?.args ?? [];
  assertEquals(args.slice(0, 3), ["api", "graphql", "-f"]);
  assertStringIncludes(args[3], "query=query(");
  assertEquals(args.slice(4), [
    "-F",
    "owner=owner",
    "-F",
    "name=repo",
    "-F",
    "expression=main:.github/workflows/hj-ci.yaml",
  ]);

  const absent = githubRunner([json({
    data: { repository: { object: null } },
  })]);
  assertEquals(await githubClient(absent).remoteFile("missing.yaml"), {
    kind: "absent",
  });

  const malformed = githubRunner([json({
    data: { repository: { object: { isBinary: true, text: "data" } } },
  })]);
  assertEquals(
    await githubClient(malformed).remoteFile("binary.yaml"),
    undefined,
  );
});

Deno.test("LocalGithubClient canonicalizes complete repository rulesets", async () => {
  const detail = reverseArrays({ ...mainProtectionDefinition, id: 41 });
  const runner = githubRunner([
    json([{ id: 41, source_type: "Repository" }]),
    json(detail),
  ]);
  const resources = await githubClient(runner).rulesets();
  assertEquals(resources?.length, 1);
  assertEquals(resources?.[0].definition, {
    ...mainProtectionDefinition,
    id: 41,
  });
  assertEquals(runner.calls.slice(2), [{
    args: [
      "api",
      "repos/owner/repo/rulesets?includes_parents=true&per_page=100&page=1",
    ],
  }, {
    args: [
      "api",
      "repos/owner/repo/rulesets/41",
    ],
  }]);
});

Deno.test("LocalGithubClient retains inherited rulesets and paginates their details", async () => {
  const inherited = Array.from({ length: 100 }, (_, index) => ({
    id: index + 1,
    source_type: "Organization",
  }));
  const runner = githubRunner([
    json(inherited),
    json([]),
    ...inherited.map(({ id }) => json({ ...mainProtectionDefinition, id })),
  ]);
  const rulesets = await githubClient(runner).rulesets();
  assertEquals(rulesets?.length, 100);
  assertEquals(rulesets?.[0].sourceType, "Organization");
  assertEquals(runner.calls.slice(2, 5).map((call) => call.args.at(-1)), [
    "repos/owner/repo/rulesets?includes_parents=true&per_page=100&page=1",
    "repos/owner/repo/rulesets?includes_parents=true&per_page=100&page=2",
    "repos/owner/repo/rulesets/1",
  ]);
});

Deno.test("LocalGithubClient rejects repeated full ruleset pages before details", async () => {
  const page = Array.from({ length: 100 }, (_, index) => ({
    id: index + 1,
    source_type: "Repository",
  }));
  const runner = githubRunner([json(page), json(page)]);
  assertEquals(await githubClient(runner).rulesets(), undefined);
  assertEquals(runner.calls.length, 4);
  assertEquals(runner.calls.at(-1), {
    args: [
      "api",
      "repos/owner/repo/rulesets?includes_parents=true&per_page=100&page=2",
    ],
  });
});

Deno.test("LocalGithubClient reads legacy and inherited protection layers", async () => {
  const runner = githubRunner([
    json([{ id: 1, source: "owner", source_type: "Organization" }]),
    json({ ...mainProtectionDefinition, id: 1 }),
    json({ allow_rebase_merge: true }),
    json({ can_approve_pull_request_reviews: true }),
    json({ protected: true }),
    json({
      required_pull_request_reviews: { required_approving_review_count: 0 },
    }),
  ]);
  const protection = await githubClient(runner).protection();
  if (!protection) throw new Error("expected protection");
  assertEquals(protection, {
    rulesets: [{
      kind: "repository-ruleset",
      name: "hj/github-main-protection",
      definition: { ...mainProtectionDefinition, id: 1 },
      stateDigest: protection.rulesets[0].stateDigest,
      source: "owner",
      sourceType: "Organization",
    }],
    repository: { allow_rebase_merge: true },
    actions: { can_approve_pull_request_reviews: true },
    legacyBranchProtection: {
      required_pull_request_reviews: { required_approving_review_count: 0 },
    },
  });
  assertEquals(runner.calls.at(-2), {
    args: ["api", "repos/owner/repo/branches/main"],
  });
  assertEquals(runner.calls.at(-1), {
    args: ["api", "repos/owner/repo/branches/main/protection"],
  });
});

Deno.test("LocalGithubClient fails closed when legacy protection availability is unknown", async () => {
  const runner = githubRunner([
    json([]),
    json({ allow_rebase_merge: true }),
    json({ can_approve_pull_request_reviews: true }),
    json({ protected: "true" }),
  ]);
  assertEquals(await githubClient(runner).protection(), undefined);
});

Deno.test("ruleset-protected branches can have no legacy protection", async () => {
  for (
    const [body, absent] of [
      [{ message: "Branch not protected", status: "404" }, true],
      [{ message: "Not Found", status: "404" }, false],
      [{ message: "Branch not protected", status: "403" }, false],
      [
        { message: "Resource not accessible by integration", status: "403" },
        false,
      ],
      [{ message: "Branch not protected" }, false],
    ] as const
  ) {
    const base = githubRunner([
      json([]),
      json({ allow_rebase_merge: true }),
      json({ can_approve_pull_request_reviews: true }),
      json({ protected: true }),
    ]);
    const client = githubClient({
      run: (args) =>
        args.at(-1)?.endsWith("/protection")
          ? Promise.resolve({ success: false, code: 1, stdout: json(body) })
          : base.run(args),
    });
    const result = await client.protection();
    assertEquals(result !== undefined, absent);
    if (absent) {
      assertEquals(result!.legacyBranchProtection, undefined);
      assertEquals(client.diagnostics, []);
    } else {
      assertEquals(client.diagnostics.length, 1);
    }
  }
});

Deno.test("LocalGithubClient fails closed for malformed ruleset responses", async () => {
  const malformed = [
    { ...mainProtectionDefinition, id: 1, bypass_actors: undefined },
    { ...mainProtectionDefinition, id: 1, conditions: undefined },
    { ...mainProtectionDefinition, id: 1, rules: undefined },
  ];
  for (const detail of malformed) {
    const runner = githubRunner([
      json([{ id: 1, source_type: "Repository" }]),
      json(detail),
    ]);
    assertEquals(await githubClient(runner).rulesets(), undefined);
  }
  for (const id of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const runner = githubRunner([
      json([{ id, source_type: "Repository" }]),
    ]);
    assertEquals(await githubClient(runner).rulesets(), undefined);
  }
  const failedDetail = githubRunner([
    json([{ id: 1, source_type: "Repository" }]),
    undefined,
  ]);
  assertEquals(await githubClient(failedDetail).rulesets(), undefined);
  const malformedSummary = githubRunner([json([{ id: 1 }])]);
  assertEquals(await githubClient(malformedSummary).rulesets(), undefined);
});

Deno.test("LocalGithubClient paginates lifecycle REST reads", async () => {
  const runs = githubRunner([
    json({
      workflow_runs: [
        ...Array.from(
          { length: 99 },
          () => ({ path: "other", status: "completed" }),
        ),
        { path: "other", status: "completed" },
      ],
    }),
    json({
      workflow_runs: [{
        path: ".github/workflows/release.yml",
        status: "completed",
      }],
    }),
  ]);
  assertEquals(
    await githubClient(runs).workflowRuns(".github/workflows/release.yml"),
    [
      { status: "completed" },
    ],
  );
  const prs = githubRunner([
    json(Array.from({ length: 100 }, (_, index) => ({
      head: { ref: `branch-${index}` },
      title: "x",
    }))),
    json([{ head: { ref: "branch-100" }, title: "y" }]),
  ]);
  assertEquals((await githubClient(prs).openPullRequests())?.length, 101);
  const branches = githubRunner([
    json(
      Array.from({ length: 100 }, (_, index) => ({ name: `branch-${index}` })),
    ),
    json([{ name: "branch-100" }]),
  ]);
  assertEquals((await githubClient(branches).branches())?.length, 101);
  const tags = githubRunner([
    json(Array.from({ length: 100 }, (_, index) => ({
      ref: `refs/tags/v${index}`,
      object: { type: "commit", sha: oid(index) },
    }))),
    json([{ ref: "refs/tags/v100", object: { type: "tag", sha: oid(100) } }]),
    json({ object: { type: "commit", sha: oid(101) } }),
  ]);
  assertEquals((await githubClient(tags).tags())?.at(-1), {
    name: "v100",
    target: oid(101),
    lightweight: false,
  });
});

Deno.test("LocalGithubClient rejects malformed lifecycle REST responses", async () => {
  const cases: [
    "workflowRuns" | "openPullRequests" | "branches" | "tags",
    unknown,
  ][] = [
    ["workflowRuns", { workflow_runs: [{ path: "x" }] }],
    ["openPullRequests", [{ head: "x" }]],
    ["branches", [{}]],
    ["tags", [{ ref: "refs/tags/v1", object: { type: "commit", sha: "bad" } }]],
    ["tags", [{
      ref: "refs/heads/v1",
      object: { type: "commit", sha: oid(1) },
    }]],
  ];
  for (const [method, response] of cases) {
    const client = githubClient(githubRunner([json(response)]));
    const result = method === "workflowRuns"
      ? await client.workflowRuns("x")
      : method === "openPullRequests"
      ? await client.openPullRequests()
      : method === "branches"
      ? await client.branches()
      : await client.tags();
    assertEquals(result, undefined);
  }
  const annotated = githubRunner([
    json([{ ref: "refs/tags/v1", object: { type: "tag", sha: oid(1) } }]),
    json({ object: { type: "blob", sha: oid(2) } }),
  ]);
  assertEquals(await githubClient(annotated).tags(), undefined);
  const repeated = githubRunner([
    json(Array.from({ length: 100 }, () => ({ name: "same" }))),
    json(Array.from({ length: 100 }, () => ({ name: "same" }))),
  ]);
  assertEquals(await githubClient(repeated).branches(), undefined);
});

Deno.test("LocalGithubClient paginates and validates default-branch history", async () => {
  const commit = (n: number) => ({
    oid: oid(n),
    messageHeadline: `commit ${n}`,
  });
  const paged = githubRunner([
    json({
      data: {
        repository: {
          ref: {
            target: {
              history: {
                nodes: [commit(1)],
                pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
              },
            },
          },
        },
      },
    }),
    json({
      data: {
        repository: {
          ref: {
            target: {
              history: {
                nodes: [commit(2)],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        },
      },
    }),
  ]);
  assertEquals(
    (await githubClient(paged).defaultBranchCommits())?.map((item) => item.oid),
    [oid(1), oid(2)],
  );
  assertEquals(paged.calls.at(-1)?.args.at(-1), "cursor=cursor-1");
  const malformed = githubRunner([
    json({
      data: {
        repository: {
          ref: {
            target: {
              history: {
                nodes: [],
                pageInfo: { hasNextPage: true },
              },
            },
          },
        },
      },
    }),
  ]);
  assertEquals(await githubClient(malformed).defaultBranchCommits(), undefined);
  const repeated = githubRunner([
    json({
      data: {
        repository: {
          ref: {
            target: {
              history: {
                nodes: [],
                pageInfo: { hasNextPage: true, endCursor: "again" },
              },
            },
          },
        },
      },
    }),
    json({
      data: {
        repository: {
          ref: {
            target: {
              history: {
                nodes: [],
                pageInfo: { hasNextPage: true, endCursor: "again" },
              },
            },
          },
        },
      },
    }),
  ]);
  assertEquals(await githubClient(repeated).defaultBranchCommits(), undefined);
  const invalid = githubRunner([
    json({
      data: {
        repository: {
          ref: {
            target: {
              history: {
                nodes: [{ oid: "bad", messageHeadline: "x" }],
                pageInfo: { hasNextPage: false },
              },
            },
          },
        },
      },
    }),
  ]);
  assertEquals(await githubClient(invalid).defaultBranchCommits(), undefined);
});

Deno.test("LocalGithubClient creates and updates guarded rulesets", async () => {
  const createRunner = githubRunner([json([]), json({})]);
  await githubClient(createRunner).upsertResources([{
    resource: "repository-ruleset",
    name: "hj/github-main-protection",
    definition: mainProtectionDefinition,
    expectedStateDigest: undefined,
  }]);
  assertEquals(createRunner.calls.at(-1), {
    args: [
      "api",
      "--method",
      "POST",
      "repos/owner/repo/rulesets",
      "--input",
      "-",
    ],
    stdin: JSON.stringify(mainProtectionDefinition),
  });

  const detail = { ...mainProtectionDefinition, id: 9 };
  const updateRunner = githubRunner([
    json([{ id: 9, source_type: "Repository" }]),
    json(detail),
    json([{ id: 9, source_type: "Repository" }]),
    json(detail),
    json({}),
  ]);
  const updateClient = githubClient(updateRunner);
  const observed = await updateClient.resource(
    "repository-ruleset",
    "hj/github-main-protection",
  );
  await updateClient.upsertResources([{
    resource: "repository-ruleset",
    name: observed!.name,
    definition: mainProtectionDefinition,
    expectedStateDigest: observed!.stateDigest,
  }]);
  assertEquals(updateRunner.calls.at(-1), {
    args: [
      "api",
      "--method",
      "PUT",
      "repos/owner/repo/rulesets/9",
      "--input",
      "-",
    ],
    stdin: JSON.stringify(mainProtectionDefinition),
  });
});

Deno.test("LocalGithubClient rejects stale, duplicate, and contradictory ruleset upserts", async () => {
  const detail = { ...mainProtectionDefinition, id: 9 };
  const staleRunner = githubRunner([
    json([{ id: 9, source_type: "Repository" }]),
    json(detail),
    json([{ id: 9, source_type: "Repository" }]),
    json({ ...detail, enforcement: "disabled" }),
  ]);
  const staleClient = githubClient(staleRunner);
  const observed = await staleClient.resource(
    "repository-ruleset",
    "hj/github-main-protection",
  );
  await assertRejects(() =>
    staleClient.upsertResources([{
      resource: "repository-ruleset",
      name: observed!.name,
      definition: mainProtectionDefinition,
      expectedStateDigest: observed!.stateDigest,
    }])
  );
  assertEquals(staleRunner.calls.length, 6);

  const duplicateRunner = githubRunner([
    json([
      { id: 9, source_type: "Repository" },
      { id: 10, source_type: "Repository" },
    ]),
    json(detail),
    json({ ...detail, id: 10 }),
  ]);
  await assertRejects(() =>
    githubClient(duplicateRunner).upsertResources([{
      resource: "repository-ruleset",
      name: "hj/github-main-protection",
      definition: mainProtectionDefinition,
      expectedStateDigest: undefined,
    }])
  );
  assertEquals(duplicateRunner.calls.length, 5);

  const noCalls = githubRunner([]);
  const client = githubClient(noCalls);
  await assertRejects(() =>
    client.upsertResources([{
      resource: "repository-ruleset",
      name: "same",
      definition: { name: "same" },
      expectedStateDigest: undefined,
    }, {
      resource: "repository-ruleset",
      name: "same",
      definition: { name: "same" },
      expectedStateDigest: undefined,
    }])
  );
  await assertRejects(() =>
    client.upsertResources([{
      resource: "repository-setting",
      name: "has_issues",
      definition: { value: true },
      expectedStateDigest: "digest",
    }, {
      resource: "repository-ruleset",
      name: "rule",
      definition: { name: "rule" },
      expectedStateDigest: undefined,
    }])
  );
  assertEquals(noCalls.calls, []);

  const mismatchRunner = githubRunner([json([])]);
  await assertRejects(() =>
    githubClient(mismatchRunner).upsertResources([{
      resource: "repository-ruleset",
      name: "expected",
      definition: { name: "different" },
      expectedStateDigest: undefined,
    }])
  );
  assertEquals(mismatchRunner.calls.length, 3);

  const inheritedRunner = githubRunner([
    json([{ id: 9, source_type: "Organization" }]),
    json({ ...mainProtectionDefinition, id: 9 }),
  ]);
  await assertRejects(() =>
    githubClient(inheritedRunner).upsertResources([{
      resource: "repository-ruleset",
      name: "hj/github-main-protection",
      definition: mainProtectionDefinition,
      expectedStateDigest: undefined,
    }])
  );
  assertEquals(inheritedRunner.calls.length, 4);
});

Deno.test("LocalGithubClient deletes only freshly matching rulesets", async () => {
  const detail = { ...mainProtectionDefinition, id: 9 };
  const deleteRunner = githubRunner([
    json([{ id: 9, source_type: "Repository" }]),
    json(detail),
    json([{ id: 9, source_type: "Repository" }]),
    json(detail),
    json({}),
  ]);
  const client = githubClient(deleteRunner);
  const observed = await client.resource(
    "repository-ruleset",
    "hj/github-main-protection",
  );
  await client.deleteResources([{
    resource: "repository-ruleset",
    name: observed!.name,
    expectedStateDigest: observed!.stateDigest,
  }]);
  assertEquals(deleteRunner.calls.at(-1), {
    args: [
      "api",
      "--method",
      "DELETE",
      "repos/owner/repo/rulesets/9",
    ],
  });

  const staleRunner = githubRunner([
    json([{ id: 9, source_type: "Repository" }]),
    json(detail),
    json([]),
  ]);
  const staleClient = githubClient(staleRunner);
  const stale = await staleClient.resource(
    "repository-ruleset",
    "hj/github-main-protection",
  );
  await assertRejects(() =>
    staleClient.deleteResources([{
      resource: "repository-ruleset",
      name: stale!.name,
      expectedStateDigest: stale!.stateDigest,
    }])
  );
  assertEquals(staleRunner.calls.length, 5);
});

class FakeRunner implements GithubCommandRunner {
  readonly calls: { args: readonly string[]; stdin?: string }[] = [];
  constructor(readonly results: readonly (Uint8Array | undefined)[]) {}
  run(args: readonly string[], stdin?: string) {
    this.calls.push({ args, ...(stdin === undefined ? {} : { stdin }) });
    const stdout = this.results[this.calls.length - 1];
    return Promise.resolve({
      success: stdout !== undefined,
      stdout: stdout ?? new Uint8Array(),
    });
  }
}
function json(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}
function oid(value: number): string {
  return value.toString(16).padStart(40, "0");
}
function githubRunner(
  results: readonly (Uint8Array | undefined)[],
): FakeRunner {
  return new FakeRunner([
    json({ login: "octo" }),
    json({ nameWithOwner: "owner/repo", defaultBranchRef: { name: "main" } }),
    ...results,
  ]);
}
function githubClient(runner: GithubCommandRunner): LocalGithubClient {
  return new LocalGithubClient(new URL("file:///tmp/opencode/"), runner);
}
function reverseArrays(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseArrays).reverse();
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        reverseArrays(item),
      ]),
    );
  }
  return value;
}

Deno.test("repository lookup rejects malformed JSON shapes without throwing", async () => {
  for (
    const value of [null, [], { nameWithOwner: 123 }, {
      nameWithOwner: "a/b/c",
    }, { nameWithOwner: "a/b", defaultBranchRef: { name: 123 } }]
  ) {
    const client = githubClient(
      new FakeRunner([json({ login: "octo" }), json(value)]),
    );
    assertEquals(await client.repository(), undefined);
  }
});

Deno.test("GitHub read diagnostics retain HTTP status without exposing response secrets", async () => {
  const client = new LocalGithubClient(new URL("file:///tmp/opencode/"), {
    run: () =>
      Promise.resolve({
        success: false,
        code: 1,
        stdout: new Uint8Array(),
        stderr: new TextEncoder().encode(
          "HTTP 401: token=private-value https://user:password@example.test",
        ),
      }),
  });
  assertEquals(await client.repository(), undefined);
  assertEquals(client.diagnostics, [
    "GitHub API request failed (HTTP 401, exit 1). Run `gh auth status` to check access.",
  ]);
});

Deno.test("GitHub mutation errors explain access failure without exposing stderr", async () => {
  const base = githubRunner([
    json({ has_issues: false }),
    json({ has_issues: false }),
  ]);
  const client = new LocalGithubClient(new URL("file:///tmp/opencode/"), {
    run: (args) =>
      args.includes("PATCH")
        ? Promise.resolve({
          success: false,
          code: 1,
          stdout: new Uint8Array(),
          stderr: new TextEncoder().encode("HTTP 403 private-token"),
        })
        : base.run(args),
  });
  const before = await client.resource("repository-setting", "has_issues");
  const error = await assertRejects(() =>
    client.upsertResources([{
      resource: "repository-setting",
      name: "has_issues",
      definition: { value: true },
      expectedStateDigest: before!.stateDigest,
    }]), Error);
  assertEquals(
    error.message,
    "GitHub API request failed (HTTP 403, exit 1). Run `gh auth status` to check access.",
  );
});

Deno.test("GitHub plan restrictions do not suggest that valid credentials are missing", async () => {
  const client = new LocalGithubClient(new URL("file:///tmp/opencode/"), {
    run: () =>
      Promise.resolve({
        success: false,
        code: 1,
        stdout: new TextEncoder().encode(JSON.stringify({
          message:
            "Upgrade to GitHub Pro or make this repository public to enable this feature.",
          other: "private-value",
        })),
        stderr: new TextEncoder().encode("HTTP 403 private-token"),
      }),
  });
  assertEquals(await client.repository(), undefined);
  assertEquals(client.diagnostics, [
    "GitHub rejected a feature because of the repository's plan or visibility. Use a public repository or a GitHub plan that supports this feature.",
  ]);
});
