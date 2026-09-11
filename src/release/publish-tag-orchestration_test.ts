import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { fromFileUrl, toFileUrl } from "@std/path";
import { publishTagPrepare } from "./publish-tag-prepare.ts";
import {
  publishTagApply,
  type PublishTagApplyGithub,
} from "./publish-tag-orchestration.ts";
import {
  type ApplyPullRequest,
  ReleasePullRequestNotFoundError,
} from "./apply-types.ts";
import { decodeReleaseBundle, type ReleaseBundle } from "./release-bundle.ts";
import {
  parseReleaseOwnershipMarker,
  type ReleaseOwnership,
} from "./release-pr.ts";
import {
  localReleaseProcess,
  type ReleaseProcess,
  runOrThrow,
} from "./release-process.ts";
import {
  releaseCheckIntegrationId,
  type SyntheticCheckRun,
} from "./synthetic-check.ts";
import { releaseBranch } from "./names.ts";

Deno.test("prepare and apply publish the exact rebased tree and remove only the release branch", async () => {
  await withRelease(async (fixture) => {
    const github = await fixture.apply();
    await assertPublished(fixture, github);
    assertEquals(github.events.length, 1);
    assert(github.mergedSha !== github.pr!.headSha);
    assertStringIncludes(
      await Deno.readTextFile(fixture.values.get("GITHUB_STEP_SUMMARY")!),
      "Release 0.1.0",
    );
    assertEquals(
      github.mutations.filter((item) => item === "push-branch").length,
      1,
    );
  });
});

Deno.test("apply resumes a reserved branch after interruption before PR creation", async () => {
  await withRelease(async (fixture) => {
    const github = await fixture.github();
    github.interruptBeforePr = true;
    await assertRejects(
      () => fixture.apply(github),
      ReleasePullRequestNotFoundError,
    );
    const branch = await github.readReleaseBranch();
    assert(branch);
    assertEquals(github.events.length, 0);
    await fixture.apply(github);
    assertEquals(github.pr!.headSha, branch);
    assertEquals(
      github.mutations.filter((item) => item === "push-branch").length,
      1,
    );
    await assertPublished(fixture, github);
  });
});

Deno.test("apply confirms uncertain branch and PR writes before continuing", async () => {
  await withRelease(async (fixture) => {
    const github = await fixture.github();
    github.uncertainWrites = true;
    await fixture.apply(github);
    await assertPublished(fixture, github);
    assertEquals(
      github.mutations.filter((item) => item === "create-pr").length,
      1,
    );
  });
});

Deno.test("recovery completes an interrupted tag publication and safely repeats the event", async () => {
  await withRelease(async (fixture) => {
    const github = await fixture.github();
    github.interruptTag = true;
    await assertRejects(
      () => fixture.apply(github),
      Error,
      "tag was not created",
    );
    assertEquals(github.pr!.state, "MERGED");
    assertEquals(await github.readTag("0.1.0"), undefined);
    await fixture.recover(github);
    await assertPublished(fixture, github);
    await fixture.recover(github);
    assertEquals(github.events.length, 2);
    assertEquals(github.events[0], github.events[1]);
    assertEquals(
      github.mutations.filter((item) => item === "push-tag").length,
      1,
    );
  });
});

Deno.test("recovery resumes after tag and branch cleanup when event delivery fails", async () => {
  await withRelease(async (fixture) => {
    const github = await fixture.github();
    github.interruptEvent = true;
    await assertRejects(
      () => fixture.apply(github),
      Error,
      "event interrupted",
    );
    await assertPublished(fixture, github);
    assertEquals(github.events.length, 0);
    await fixture.recover(github);
    assertEquals(github.events.length, 1);
    assertEquals(
      github.mutations.filter((item) => item === "push-tag").length,
      1,
    );
  });
});

Deno.test("apply rejects a changed main before GitHub writes", async () => {
  await withRelease(async (fixture) => {
    const github = await fixture.github();
    await runOrThrow(github.process, "git", [
      "commit",
      "--allow-empty",
      "-m",
      "fix: concurrent source",
    ]);
    await runOrThrow(github.process, "git", ["push", "origin", "HEAD:main"]);
    await assertRejects(
      () => fixture.apply(github),
      Error,
      "origin/main changed",
    );
    assertEquals(github.mutations, []);
  });
});

Deno.test("apply preserves a reserved branch with a different tree", async () => {
  await withRelease(async (fixture) => {
    const github = await fixture.github();
    await runOrThrow(github.process, "git", [
      "commit",
      "--allow-empty",
      "-m",
      "chore(release): 0.1.0",
    ]);
    const foreign =
      (await runOrThrow(github.process, "git", ["rev-parse", "HEAD"])).trim();
    await runOrThrow(github.process, "git", [
      "push",
      "origin",
      `HEAD:refs/heads/${releaseBranch("0.1.0")}`,
    ]);
    await assertRejects(
      () => fixture.apply(github),
      Error,
      "does not match bundle",
    );
    assertEquals(await github.readReleaseBranch(), foreign);
    assertEquals(github.mutations, []);
  });
});

Deno.test("source-first collision closes the owned PR without publishing a tag", async () => {
  await withRelease(async (fixture) => {
    const github = await fixture.github();
    github.sourceWins = true;
    await fixture.apply(github);
    assertEquals(github.pr!.state, "CLOSED");
    assertEquals(await github.readReleaseBranch(), undefined);
    assertEquals(await github.readTag("0.1.0"), undefined);
    assertEquals(github.events, []);
  });
});

async function assertPublished(
  fixture: Fixture,
  github: Github,
): Promise<void> {
  const tag = await github.readTag(fixture.bundle.nextVersion);
  assertEquals(tag, github.mergedSha);
  assert(tag);
  assertEquals(await github.readReleaseBranch(), undefined);
  const process = github.process;
  await runOrThrow(process, "git", ["fetch", "origin", "--tags"]);
  assertEquals(
    (await runOrThrow(process, "git", [
      "cat-file",
      "-t",
      fixture.bundle.nextVersion,
    ])).trim(),
    "commit",
  );
  assertEquals(
    await runOrThrow(process, "git", ["show", `${tag}:deno.json`]),
    fixture.bundle.versionFile.text,
  );
  assertStringIncludes(
    await runOrThrow(process, "git", ["show", `${tag}:CHANGELOG.md`]),
    "feat: initial release",
  );
  assertEquals(
    (await runOrThrow(process, "git", ["show", "-s", "--format=%P", tag]))
      .trim(),
    fixture.bundle.selectedSha,
  );
  assertEquals(
    (await runOrThrow(process, "git", ["rev-parse", `${tag}^{tree}`])).trim(),
    (await runOrThrow(process, "git", [
      "rev-parse",
      `${github.pr!.headSha}^{tree}`,
    ])).trim(),
  );
}

type Fixture = {
  bundle: ReleaseBundle;
  values: Map<string, string>;
  github(): Promise<Github>;
  apply(github?: Github): Promise<Github>;
  recover(github: Github): Promise<void>;
};

async function withRelease(
  action: (fixture: Fixture) => Promise<void>,
): Promise<void> {
  const parent = await Deno.makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-orchestration-",
  });
  const remote = `${parent}/remote.git`;
  let serial = 0;
  try {
    const seed = toFileUrl(`${parent}/seed/`);
    await Deno.mkdir(seed);
    const process = localReleaseProcess(seed);
    await runOrThrow(process, "git", [
      "init",
      "--bare",
      "--initial-branch=main",
      remote,
    ]);
    await runOrThrow(process, "git", ["init", "--initial-branch=main"]);
    await identity(process);
    await Deno.writeTextFile(
      new URL("deno.json", seed),
      '{"version":"0.0.0","tasks":{"all":"deno eval \'Deno.exit(0)\'"}}\n',
    );
    await runOrThrow(process, "git", ["add", "deno.json"]);
    await runOrThrow(process, "git", ["commit", "-m", "feat: initial release"]);
    await runOrThrow(process, "git", ["remote", "add", "origin", remote]);
    await runOrThrow(process, "git", ["push", "origin", "main"]);
    const values = new Map([
      ["HJ_RELEASE_ROUTE", "usual"],
      ["GITHUB_OUTPUT", `${parent}/output`],
      ["GITHUB_STEP_SUMMARY", `${parent}/summary`],
      ["GITHUB_RUN_ID", "123"],
      ["GITHUB_RUN_ATTEMPT", "1"],
      ["GITHUB_SERVER_URL", "https://github.com"],
      ["GITHUB_REPOSITORY", "owner/repo"],
    ]);
    const environment = { get: (name: string) => values.get(name) };
    const prepare = async (root: URL, local: ReleaseProcess) => {
      await Deno.writeTextFile(values.get("GITHUB_OUTPUT")!, "");
      await publishTagPrepare(root, environment, local);
      const output = Object.fromEntries(
        (await Deno.readTextFile(values.get("GITHUB_OUTPUT")!)).trim().split(
          "\n",
        ).map((line) => {
          const index = line.indexOf("=");
          return [line.slice(0, index), line.slice(index + 1)];
        }),
      );
      values.set("HJ_RELEASE_BUNDLE", output["release-bundle"]);
      values.set("HJ_RELEASE_BUNDLE_DIGEST", output["bundle-digest"]);
      return await decodeReleaseBundle(
        output["release-bundle"],
        output["bundle-digest"],
      );
    };
    const bundle = await prepare(seed, process);
    const checkout = async () => {
      // Spaces exercise file-URL decoding in the real process adapter.
      const root = toFileUrl(`${parent}/checkout ${serial++}/`);
      await runOrThrow(process, "git", ["clone", remote, fromFileUrl(root)]);
      const local = localReleaseProcess(root);
      await identity(local);
      return { root, local };
    };
    const fixture: Fixture = {
      bundle,
      values,
      async github() {
        const { local } = await checkout();
        return new Github(local, bundle);
      },
      async apply(github) {
        github ??= await fixture.github();
        const { root, local } = await checkout();
        github.process = local;
        await publishTagApply(root, environment, local, github, github.clock);
        return github;
      },
      async recover(github) {
        values.set("HJ_RELEASE_ROUTE", "recovery");
        values.set("HJ_RELEASE_TAG", bundle.nextVersion);
        const prepared = await checkout();
        await prepare(prepared.root, prepared.local);
        await fixture.apply(github);
      },
    };
    await action(fixture);
  } finally {
    await Deno.remove(parent, { recursive: true });
  }
}

async function identity(process: ReleaseProcess): Promise<void> {
  await runOrThrow(process, "git", ["config", "user.name", "Test"]);
  await runOrThrow(process, "git", [
    "config",
    "user.email",
    "test@example.invalid",
  ]);
  await runOrThrow(process, "git", ["config", "commit.gpgSign", "false"]);
}

/** Git refs are real; this adapter models only GitHub PRs, checks, and events. */
class Github implements PublishTagApplyGithub {
  pr: ApplyPullRequest | undefined;
  runs: SyntheticCheckRun[] = [];
  mutations: string[] = [];
  events: unknown[] = [];
  mergedSha: string | undefined;
  interruptBeforePr = false;
  interruptTag = false;
  interruptEvent = false;
  uncertainWrites = false;
  sourceWins = false;
  time = 0;
  constructor(public process: ReleaseProcess, readonly bundle: ReleaseBundle) {}
  clock = {
    now: () => this.time,
    sleep: async (milliseconds: number) => {
      this.time += milliseconds;
      if (
        this.pr?.state !== "OPEN" || !this.pr.autoMerge ||
        !this.runs.every((run) => run.conclusion === "success")
      ) return;
      const parent = this.bundle.selectedSha;
      const tree = (await runOrThrow(this.process, "git", [
        "rev-parse",
        `${this.pr.headSha}^{tree}`,
      ])).trim();
      const commit = (await runOrThrow(this.process, "git", [
        "-c",
        "user.name=GitHub Rebase",
        "commit-tree",
        tree,
        "-p",
        parent,
        "-m",
        this.sourceWins ? "fix: concurrent source" : this.pr.title,
      ])).trim();
      await runOrThrow(this.process, "git", [
        "push",
        "origin",
        `${commit}:refs/heads/main`,
      ]);
      if (!this.sourceWins) {
        this.mergedSha = commit;
        this.pr = { ...this.pr, state: "MERGED" };
      }
    },
  };
  async readRef(ref: string): Promise<string | undefined> {
    const text =
      (await runOrThrow(this.process, "git", ["ls-remote", "origin", ref]))
        .trim();
    return text ? text.split("\t")[0] : undefined;
  }
  readReleaseBranch() {
    return this.readRef(`refs/heads/${releaseBranch(this.bundle.nextVersion)}`);
  }
  readTag(tag: string) {
    return this.readRef(`refs/tags/${tag}`);
  }
  async fetchMainSha() {
    return (await this.readRef("refs/heads/main"))!;
  }
  async pushReleaseBranch(branch: string, sha: string) {
    this.mutations.push("push-branch");
    await runOrThrow(this.process, "git", [
      "push",
      "origin",
      `${sha}:refs/heads/${branch}`,
    ]);
    if (this.uncertainWrites) throw new Error("response lost");
  }
  async createReleasePullRequest(
    input: { title: string; body: string; head: string },
  ) {
    if (this.interruptBeforePr) {
      this.interruptBeforePr = false;
      throw new Error("interrupted");
    }
    this.mutations.push("create-pr");
    this.pr = {
      id: "PR",
      title: input.title,
      state: "OPEN",
      headSha: (await this.readReleaseBranch())!,
      mergeStateStatus: "BLOCKED",
      ownership: parseReleaseOwnershipMarker(input.body),
      autoMerge: undefined,
    };
    if (this.uncertainWrites) throw new Error("response lost");
  }
  readPullRequest(): Promise<ApplyPullRequest> {
    if (!this.pr) return Promise.reject(new ReleasePullRequestNotFoundError());
    return Promise.resolve(this.pr);
  }
  listCheckRuns() {
    return Promise.resolve(this.runs);
  }
  createCheckRun(
    input: {
      name: string;
      headSha: string;
      externalId: string;
      detailsUrl: string;
    },
  ) {
    const run: SyntheticCheckRun = {
      ...input,
      id: this.runs.length + 1,
      integrationId: releaseCheckIntegrationId,
      status: "in_progress",
      conclusion: null,
    };
    this.runs.push(run);
    return Promise.resolve(run);
  }
  completeCheckRun(
    id: number,
    conclusion: "success" | "neutral" | "cancelled",
  ) {
    this.runs = this.runs.map((run) =>
      run.id === id ? { ...run, status: "completed", conclusion } : run
    );
    return Promise.resolve();
  }
  enablePullRequestAutoMerge(input: { expectedHeadOid: string }) {
    assertEquals(input.expectedHeadOid, this.pr!.headSha);
    this.pr = {
      ...this.pr!,
      autoMerge: { mergeMethod: "REBASE", enabledBy: "github-actions[bot]" },
    };
    return Promise.resolve();
  }
  disablePullRequestAutoMerge() {
    this.pr = { ...this.pr!, autoMerge: undefined };
    return Promise.resolve();
  }
  closePullRequest() {
    this.pr = { ...this.pr!, state: "CLOSED" };
    return Promise.resolve();
  }
  mergedPullRequestsForReleaseBranch(): Promise<
    readonly { ownership: ReleaseOwnership | undefined }[]
  > {
    return Promise.resolve(
      this.pr?.state === "MERGED" ? [{ ownership: this.pr.ownership }] : [],
    );
  }
  async deleteReleaseBranchWithLease(branch: string, sha: string) {
    const current = await this.readReleaseBranch();
    if (!current) return "missing" as const;
    if (current !== sha) return "lease-mismatch" as const;
    this.mutations.push("delete-branch");
    await runOrThrow(this.process, "git", [
      "push",
      `--force-with-lease=refs/heads/${branch}:${sha}`,
      "origin",
      `:refs/heads/${branch}`,
    ]);
    return "deleted" as const;
  }
  async pushLightweightTag(tag: string, target: string) {
    if (this.interruptTag) {
      this.interruptTag = false;
      throw new Error("tag interrupted");
    }
    this.mutations.push("push-tag");
    await runOrThrow(this.process, "git", [
      "push",
      "origin",
      `${target}:refs/tags/${tag}`,
    ]);
  }
  sendSuccessEvent(payload: unknown) {
    if (this.interruptEvent) {
      this.interruptEvent = false;
      return Promise.reject(new Error("event interrupted"));
    }
    this.events.push(payload);
    return Promise.resolve();
  }
}
