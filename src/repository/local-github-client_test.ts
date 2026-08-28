import { assertEquals, assertRejects } from "@std/assert";
import {
  type GithubCommandRunner,
  LocalGithubClient,
} from "./local-github-client.ts";

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
