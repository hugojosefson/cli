import { assertEquals, assertRejects } from "@std/assert";
import type {
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
  fail = false;
  repository() {
    return Promise.resolve(undefined);
  }
  rulesets() {
    return Promise.resolve([]);
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
  upsertResources(items: readonly GithubResourceUpsert[]) {
    this.calls.push(`upsert:${items.map((item) => item.name).join(",")}`);
    return this.fail ? Promise.reject(new Error("failed")) : Promise.resolve();
  }
  deleteResources(items: readonly GithubResourceDelete[]) {
    this.calls.push(`delete:${items.map((item) => item.name).join(",")}`);
    return Promise.resolve();
  }
}
const plan = (changes: PlannedChange[]) => ({
  featureId: "x",
  action: "enable" as const,
  summary: "x",
  warnings: [],
  preconditions: [],
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

Deno.test("GitHub plans batch settings and order rulesets", async () => {
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
Deno.test("GitHub ruleset plan failure stops later operations", async () => {
  const writer = new Writer();
  writer.fail = true;
  await assertRejects(() =>
    applyGithubChangePlans(writer, [plan([rule("a"), rule("b")])])
  );
  assertEquals(writer.calls, ["upsert:a"]);
});
Deno.test("GitHub plans reject contradictory and unsupported remote operations", async () => {
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
