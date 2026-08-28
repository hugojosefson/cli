import { assertEquals, assertRejects } from "@std/assert";
import {
  type GithubCommandRunner,
  LocalGithubClient,
} from "./local-github-client.ts";
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
      "repos/owner/repo/rulesets?includes_parents=false&per_page=100&page=1",
    ],
  }, {
    args: [
      "api",
      "repos/owner/repo/rulesets/41?includes_parents=false",
    ],
  }]);
});

Deno.test("LocalGithubClient paginates rulesets and ignores inherited sources", async () => {
  const inherited = Array.from({ length: 100 }, (_, id) => ({
    id: id + 1,
    source_type: id % 2 ? "Organization" : "Enterprise",
  }));
  const runner = githubRunner([
    json(inherited),
    json([{ id: 101, source_type: "Repository" }]),
    json({ ...mainProtectionDefinition, id: 101 }),
  ]);
  assertEquals((await githubClient(runner).rulesets())?.length, 1);
  assertEquals(runner.calls.slice(2).map((call) => call.args.at(-1)), [
    "repos/owner/repo/rulesets?includes_parents=false&per_page=100&page=1",
    "repos/owner/repo/rulesets?includes_parents=false&per_page=100&page=2",
    "repos/owner/repo/rulesets/101?includes_parents=false",
  ]);
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
function githubRunner(
  results: readonly (Uint8Array | undefined)[],
): FakeRunner {
  return new FakeRunner([
    json({ login: "octo" }),
    json({ nameWithOwner: "owner/repo", defaultBranchRef: { name: "main" } }),
    ...results,
  ]);
}
function githubClient(runner: FakeRunner): LocalGithubClient {
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
