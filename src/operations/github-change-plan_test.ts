import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import { assertEquals, assertRejects } from "@std/assert";
import type { ChangePlan } from "../api/change-plan.ts";
import type {
  GithubRemoteFile,
  GithubResource,
  GithubResourceDelete,
  GithubResourceUpsert,
  GithubWriter,
} from "../api/repository-context.ts";
import type { PlannedChange } from "../api/planned-change.ts";
import {
  applyGithubChangePlans,
  preflightGithubChangePlan,
} from "./github-change-plan.ts";

class Writer implements GithubWriter {
  readonly calls: string[] = [];
  readonly state: GithubResource[] = [];
  reads = 0;
  fail = false;
  remote: unknown = { kind: "absent" };
  repository() {
    return Promise.resolve(undefined);
  }
  rulesets() {
    this.reads++;
    return Promise.resolve(this.state);
  }
  environments() {
    return Promise.resolve([]);
  }
  variables() {
    return Promise.resolve([]);
  }
  secretExists() {
    return Promise.resolve(undefined);
  }
  resource() {
    return Promise.resolve(undefined as GithubResource | undefined);
  }
  remoteFile() {
    return Promise.resolve(this.remote as GithubRemoteFile | undefined);
  }
  upsertResources(items: readonly GithubResourceUpsert[]) {
    this.calls.push(`upsert:${items.map((item) => item.name).join(",")}`);
    if (this.fail) return Promise.reject(new Error("failed"));
    for (const item of items) {
      const existing = this.state.findIndex((resource) =>
        resource.name === item.name
      );
      const resource = {
        kind: item.resource,
        name: item.name,
        definition: item.definition,
        stateDigest: `${item.name}-${this.calls.length}`,
        sourceType: "Repository",
      };
      if (existing < 0) this.state.push(resource);
      else this.state[existing] = resource;
    }
    return Promise.resolve();
  }
  deleteResources(items: readonly GithubResourceDelete[]) {
    this.calls.push(`delete:${items.map((item) => item.name).join(",")}`);
    for (const item of items) {
      const index = this.state.findIndex((resource) =>
        resource.name === item.name
      );
      if (index >= 0) this.state.splice(index, 1);
    }
    return Promise.resolve();
  }
}
const plan = (
  changes: PlannedChange[],
  preconditions: ChangePlan["preconditions"] = [],
) => ({
  featureId: "x",
  action: "enable" as const,
  summary: "x",
  warnings: [],
  preconditions,
  changes,
  validations: [],
});
const rule = (name: string) => ({
  kind: "upsert-github-resource" as const,
  resource: "repository-ruleset",
  name,
  definition: { name },
  expectedStateDigest: undefined,
});
const remoteFilePlan = (expectedContent = "expected\n") =>
  plan([rule("main")], [
    {
      kind: "github-resource-state",
      resource: "repository-ruleset",
      name: "main",
      stateDigest: undefined,
    },
    {
      kind: "github-remote-file",
      path: ".github/workflows/hj-ci.yaml",
      expectedContent,
    },
  ]);

test("GitHub plans batch settings and order rulesets", async () => {
  const writer = new Writer();
  await applyGithubChangePlans(writer, [
    plan([{
      kind: "upsert-github-resource",
      resource: "repository-setting",
      name: "a",
      definition: { value: true },
      expectedStateDigest: "a",
    }, {
      kind: "upsert-github-resource",
      resource: "repository-setting",
      name: "b",
      definition: { value: false },
      expectedStateDigest: "b",
    }]),
    plan([rule("z"), rule("a"), {
      kind: "delete-github-resource",
      resource: "repository-ruleset",
      name: "q",
      expectedStateDigest: "q",
    }]),
  ]);
  assertEquals(writer.calls, [
    "upsert:a,b",
    "upsert:a",
    "upsert:z",
    "delete:q",
  ]);
});
test("GitHub ruleset plan failure stops later operations", async () => {
  const writer = new Writer();
  writer.fail = true;
  await assertRejects(() =>
    applyGithubChangePlans(writer, [plan([rule("a"), rule("b")])])
  );
  assertEquals(writer.calls, ["upsert:a"]);
});
test("GitHub remote file preconditions reject unavailable or malformed data", async () => {
  for (
    const remote of [
      undefined,
      { kind: "absent" },
      { kind: "file" },
      { kind: "file", content: "changed\n" },
    ]
  ) {
    const writer = new Writer();
    writer.remote = remote;
    await assertRejects(() =>
      preflightGithubChangePlan(writer, remoteFilePlan())
    );
    assertEquals(writer.calls, []);
  }
});
test("GitHub apply rereads remote file preconditions before mutations", async () => {
  const writer = new Writer();
  const plan = remoteFilePlan();
  writer.remote = { kind: "file", content: "expected\n" };
  await preflightGithubChangePlan(writer, plan);
  writer.remote = { kind: "file", content: "changed\n" };
  await assertRejects(() => applyGithubChangePlans(writer, [plan]));
  assertEquals(writer.calls, []);
});
test("GitHub ruleset transitions reread exact state after each request", async () => {
  const writer = new Writer();
  await applyGithubChangePlans(writer, [plan([{
    kind: "github-ruleset-transition",
    steps: [{
      change: { kind: "upsert", name: "a", definition: { name: "a" } },
      before: [{ name: "a" }, { name: "b" }],
      after: [{ name: "a", definition: { name: "a" } }, { name: "b" }],
    }, {
      change: { kind: "upsert", name: "b", definition: { name: "b" } },
      before: [{ name: "a", definition: { name: "a" } }, { name: "b" }],
      after: [
        { name: "a", definition: { name: "a" } },
        { name: "b", definition: { name: "b" } },
      ],
    }],
  }])]);
  assertEquals(writer.calls, ["upsert:a", "upsert:b"]);
  assertEquals(writer.reads, 4);
});
test("GitHub applies main rulesets before a disjoint tag transition", async () => {
  const writer = new Writer();
  await applyGithubChangePlans(writer, [plan([rule("main"), {
    kind: "github-ruleset-transition",
    steps: [{
      change: { kind: "upsert", name: "tag-a", definition: { name: "tag-a" } },
      before: [{ name: "tag-a" }, { name: "tag-b" }],
      after: [{ name: "tag-a", definition: { name: "tag-a" } }, {
        name: "tag-b",
      }],
    }],
  }])]);
  assertEquals(writer.calls, ["upsert:main", "upsert:tag-a"]);
});
test("GitHub plans reject contradictory and unsupported remote operations", async () => {
  const writer = new Writer();
  const duplicates = plan([{
    kind: "delete-github-resource",
    resource: "repository-ruleset",
    name: "a",
    expectedStateDigest: "a",
  }, {
    kind: "delete-github-resource",
    resource: "repository-ruleset",
    name: "a",
    expectedStateDigest: "a",
  }]);
  await assertRejects(() => applyGithubChangePlans(writer, [duplicates]));
  await assertRejects(() =>
    applyGithubChangePlans(writer, [plan([rule("a"), rule("a")])])
  );
  await assertRejects(() =>
    applyGithubChangePlans(writer, [plan([rule("a"), {
      kind: "delete-github-resource",
      resource: "repository-ruleset",
      name: "a",
      expectedStateDigest: "a",
    }])])
  );
  await assertRejects(() =>
    preflightGithubChangePlan(
      writer,
      plan([{
        kind: "upsert-github-resource",
        resource: "nope",
        name: "a",
        definition: {},
        expectedStateDigest: undefined,
      }]),
    )
  );
  await assertRejects(() =>
    preflightGithubChangePlan(writer, plan([rule("a")]))
  );
  await assertRejects(() =>
    preflightGithubChangePlan(
      writer,
      plan([{
        kind: "app-setup",
        name: "app",
        repository: "owner/repo",
        environment: "release",
        secretName: "secret",
        nonSecretConfiguration: {},
      }]),
    )
  );
  assertEquals(writer.calls, []);
});
