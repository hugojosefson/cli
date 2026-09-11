import { ReleasePullRequestNotFoundError } from "./apply-types.ts";
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { PullRequestCleanStatusError } from "./apply-types.ts";
import { publishTagGithub } from "./publish-tag-github.ts";
import type { ReleaseProcess } from "./release-process.ts";

const sha = "a".repeat(40);
const calls: { command: string; args: readonly string[]; stdin?: string }[] =
  [];

function process(
  reply: (command: string, args: readonly string[]) => string,
): ReleaseProcess {
  return {
    run(command, args, options) {
      calls.push({ command, args, stdin: options?.stdin });
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: new TextEncoder().encode(reply(command, args)),
        stderr: new Uint8Array(),
      });
    },
  };
}

function github(reply: (command: string, args: readonly string[]) => string) {
  return publishTagGithub(
    process(reply),
    { owner: "owner", name: "repo" },
    "release-1.2.3",
  );
}

Deno.test("paginates check runs with gh slurp JSON", async () => {
  calls.length = 0;
  const api = github((_command, args) =>
    args.includes("--paginate")
      ? JSON.stringify([{ check_runs: [run(1)] }, { check_runs: [run(2)] }])
      : JSON.stringify(run(3))
  );
  assertEquals((await api.listCheckRuns(sha)).map(({ id }) => id), [1, 2]);
  await api.createCheckRun({
    name: "check",
    headSha: sha,
    externalId: "id",
    detailsUrl: "https://example.test",
  });
  assertEquals(calls[0], {
    command: "gh",
    args: [
      "api",
      "--paginate",
      "--slurp",
      `repos/owner/repo/commits/${sha}/check-runs?filter=all&per_page=100`,
    ],
    stdin: undefined,
  });
  assertEquals(
    calls[1].stdin,
    JSON.stringify({
      name: "check",
      head_sha: sha,
      status: "in_progress",
      external_id: "id",
      details_url: "https://example.test",
    }),
  );
});

Deno.test("recognizes only GitHub's exact clean-status error", async () => {
  calls.length = 0;
  const api = github((_command, args) => {
    const query = args.find((arg) => arg.startsWith("query=")) ?? "";
    return query.includes("enablePullRequestAutoMerge")
      ? JSON.stringify({
        errors: [{ message: "Pull request Pull request is in clean status" }],
      })
      : JSON.stringify({ data: {} });
  });
  await assertRejects(
    () =>
      api.enablePullRequestAutoMerge({
        id: "PR",
        mergeMethod: "REBASE",
        expectedHeadOid: sha,
      }),
    PullRequestCleanStatusError,
  );
  assertStringIncludes(calls[0].args.join(" "), "expectedHeadOid");
});

Deno.test("accepts lightweight tags and rejects annotated tags", async () => {
  calls.length = 0;
  const lightweight = github((command, args) =>
    command === "git" && args[0] === "ls-remote"
      ? `${sha}\trefs/tags/1.2.3\n`
      : ""
  );
  assertEquals(await lightweight.readTag("1.2.3"), sha);
  const annotated = github((command, args) =>
    command === "git" && args[0] === "ls-remote"
      ? `${"b".repeat(40)}\trefs/tags/1.2.3\n${sha}\trefs/tags/1.2.3^{}\n`
      : ""
  );
  await assertRejects(() => annotated.readTag("1.2.3"), TypeError);
});

Deno.test("dispatch accepts GitHub's empty 204 response and rejects a body", async () => {
  calls.length = 0;
  const api = github(() => "");
  await api.sendSuccessEvent({
    schema: 1,
    version: "1.2.3",
    tag: "1.2.3",
    releaseSha: sha,
  });
  assertEquals(
    calls[0].stdin,
    JSON.stringify({
      event_type: "hj-release-publish-tag-success",
      client_payload: {
        schema: 1,
        version: "1.2.3",
        tag: "1.2.3",
        releaseSha: sha,
      },
    }),
  );
  await assertRejects(
    () =>
      github(() => "unexpected").sendSuccessEvent({
        schema: 1,
        version: "1.2.3",
        tag: "1.2.3",
        releaseSha: sha,
      }),
    TypeError,
  );
});

Deno.test("distinguishes zero, one, ambiguous, and later merged release PRs", async () => {
  const page = (nodes: unknown[]) =>
    JSON.stringify({
      data: {
        repository: {
          pullRequests: {
            nodes,
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    });
  await assertRejects(
    () =>
      github((_command, args) => {
        const query = args.find((arg) => arg.startsWith("query=")) ?? "";
        assertStringIncludes(
          query,
          "autoMergeRequest{mergeMethod enabledBy{login}}} pageInfo{hasNextPage endCursor}",
        );
        return page([]);
      }).readPullRequest(),
    ReleasePullRequestNotFoundError,
  );
  const one = pullRequest("OPEN");
  const single = github(() => page([one]));
  assertEquals((await single.readPullRequest()).id, "PR1");
  await assertRejects(
    () => github(() => page([one, one])).readPullRequest(),
    TypeError,
  );
  let reads = 0;
  const remembered = github((_command, args) => {
    const query = args.find((arg) => arg.startsWith("query=")) ?? "";
    reads++;
    return query.includes("node(id:$pullRequestId)")
      ? JSON.stringify({ data: { node: pullRequest("MERGED") } })
      : page([one]);
  });
  assertEquals((await remembered.readPullRequest()).state, "OPEN");
  assertEquals((await remembered.readPullRequest()).state, "MERGED");
  assertEquals(reads, 2);

  const foreign = {
    ...one,
    headRepository: { nameWithOwner: "other/repo" },
  };
  await assertRejects(
    () => github(() => page([foreign])).readPullRequest(),
    TypeError,
  );
});

Deno.test("validates mutation payloads, merged PR pages, and branch deletion leases", async () => {
  calls.length = 0;
  let mergedPage = 0;
  const api = github((command, args) => {
    const query = args.find((arg) => arg.startsWith("query=")) ?? "";
    if (query.includes("disablePullRequestAutoMerge")) {
      return JSON.stringify({
        data: {
          disablePullRequestAutoMerge: { pullRequest: { id: "PR1" } },
        },
      });
    }
    if (query.includes("states:[MERGED]")) {
      mergedPage++;
      return JSON.stringify({
        data: {
          repository: {
            pullRequests: {
              nodes: [{
                body: "release",
                headRefName: "release-1.2.3",
                baseRefName: "main",
                headRepository: { nameWithOwner: "owner/repo" },
                baseRepository: { nameWithOwner: "owner/repo" },
              }],
              pageInfo: {
                hasNextPage: mergedPage === 1,
                endCursor: mergedPage === 1 ? "next" : null,
              },
            },
          },
        },
      });
    }
    if (command === "git" && args[0] === "ls-remote") {
      return `${sha}\trefs/heads/release-1.2.3\n`;
    }
    return "";
  });
  await api.disablePullRequestAutoMerge("PR1");
  assertEquals((await api.mergedPullRequestsForReleaseBranch()).length, 2);
  assertEquals(
    await api.deleteReleaseBranchWithLease("release-1.2.3", sha),
    "deleted",
  );
  assertEquals(calls.at(-1)?.args, [
    "push",
    `--force-with-lease=refs/heads/release-1.2.3:${sha}`,
    "origin",
    ":refs/heads/release-1.2.3",
  ]);

  const malformed = github((_command, args) => {
    const query = args.find((arg) => arg.startsWith("query=")) ?? "";
    return query.includes("closePullRequest")
      ? JSON.stringify({ data: { closePullRequest: {} } })
      : "";
  });
  await assertRejects(() => malformed.closePullRequest("PR1"), TypeError);
});

Deno.test("rejects SemVer leading zero tags and branches", async () => {
  assertThrows(() =>
    publishTagGithub(process(() => ""), {
      owner: "owner",
      name: "repo",
    }, "release-01.2.3"), TypeError);
  const api = github(() => "");
  await assertRejects(() => api.readTag("1.02.3"), TypeError);
});

function pullRequest(state: "OPEN" | "MERGED") {
  return {
    id: "PR1",
    title: "chore(release): 1.2.3",
    state,
    headRefName: "release-1.2.3",
    baseRefName: "main",
    headRefOid: sha,
    mergeStateStatus: "BLOCKED",
    body: "release",
    headRepository: { nameWithOwner: "owner/repo" },
    baseRepository: { nameWithOwner: "owner/repo" },
    autoMergeRequest: null,
  };
}

function run(id: number) {
  return {
    id,
    name: "check",
    head_sha: sha,
    app: { id: 15368 },
    external_id: "foreign",
    details_url: null,
    status: "in_progress",
    conclusion: null,
  };
}
