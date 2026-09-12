import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  type AutoAddBrowser,
  type AutoAddSnapshot,
  enableProjectAutoAdd,
  EndpointUnavailable,
  planAutoAdd,
  sameWorkflows,
  UncertainProjectWrite,
  validateAutoAddTarget,
  workflowRequest,
} from "./auto-add.ts";
import {
  after,
  before,
  enabled,
  target,
  template,
} from "./auto-add-test-fixtures.ts";

Deno.test("auto-add creates all-issue workflow from the server template", () => {
  const plan = planAutoAdd(target, before)!;
  assertEquals(plan.workflow.contentTypes, ["Issue"]);
  assertEquals(
    plan.workflow.actions.map((item) => item.arguments.repositoryId),
    [42, 42],
  );
  assertEquals(workflowRequest(plan), {
    url: "https://github.com/memexes/123/workflows",
    method: "POST",
    body: { workflow: plan.workflow },
  });
  assertEquals(planAutoAdd(target, after), undefined);
  assertEquals(
    planAutoAdd(target, {
      ...before,
      workflows: [{
        ...enabled,
        actions: [{
          ...enabled.actions[0],
          arguments: { repositoryId: 42, query: "is:issue" },
        }, enabled.actions[1]],
      }],
    }),
    undefined,
  );
});
Deno.test("auto-add enables a disabled exact workflow without replacing its filter", () => {
  const plan = planAutoAdd(target, {
    ...before,
    workflows: [{ ...enabled, enabled: false }],
  })!;
  assertEquals(workflowRequest(plan).body, {
    workflowNumber: 3,
    enabled: true,
  });
  assertEquals(workflowRequest(plan).method, "PUT");
});
Deno.test("auto-add preserves custom, duplicate, and unknown workflow configurations", () => {
  assertThrows(
    () => planAutoAdd(target, { ...before, workflows: [enabled, enabled] }),
    Error,
    "Multiple",
  );
  assertThrows(
    () =>
      planAutoAdd(target, {
        ...before,
        workflows: [{ ...enabled, contentTypes: ["Issue", "PullRequest"] }],
      }),
    Error,
    "custom",
  );
  assertThrows(
    () => planAutoAdd(target, { ...before, template: undefined }),
    Error,
    "template",
  );
  assertThrows(
    () =>
      planAutoAdd(target, {
        ...before,
        template: {
          ...template,
          actions: [...template.actions, {
            actionType: "unknown",
            arguments: {},
          }],
        },
      }),
    Error,
    "schema",
  );
  const unrelated = {
    ...enabled,
    actions: enabled.actions.map((action) => ({
      ...action,
      arguments: { ...action.arguments, repositoryId: 99 },
    })),
  };
  const plan = planAutoAdd(target, { ...before, workflows: [unrelated] })!;
  assertEquals(plan.workflow.name, "Auto-add example/cli");
  assertEquals(plan.before.workflows, [unrelated]);
});
Deno.test("auto-add rejects foreign targets and endpoint changes", () => {
  for (
    const change of [
      { projectUrl: "https://example.org/users/example/projects/10" },
      { projectUrl: target.projectUrl + "?query=1" },
      { repository: "owner/name/extra" },
      { repositoryId: 0 },
    ]
  ) {
    assertThrows(() => validateAutoAddTarget({ ...target, ...change }));
  }
  for (
    const createUrl of [
      undefined,
      "https://other.example/memexes/123/workflows",
      "/memexes/456/workflows",
      "/memexes/123/workflows?q=1",
    ]
  ) {
    assertThrows(
      () => workflowRequest(planAutoAdd(target, { ...before, createUrl })!),
      EndpointUnavailable,
    );
  }
  assertThrows(
    () =>
      workflowRequest(
        planAutoAdd(target, {
          ...before,
          workflows: [{ ...enabled, enabled: false, number: undefined }],
        })!,
      ),
    EndpointUnavailable,
  );
});

function browser(
  reads: AutoAddSnapshot[],
  error?: Error,
  changedAfterWrite = after,
) {
  let writes = 0;
  let clicks = 0;
  let current = before;
  const adapter: AutoAddBrowser = {
    inspect() {
      current = reads.shift() ?? current;
      return Promise.resolve(current);
    },
    request() {
      writes++;
      if (error) return Promise.reject(error);
      current = changedAfterWrite;
      return Promise.resolve();
    },
    configure() {
      clicks++;
      current = after;
      return Promise.resolve();
    },
  };
  return { adapter, counts: () => [writes, clicks] };
}
Deno.test("auto-add confirms successful endpoint writes and skips existing workflows", async () => {
  const service = browser([before, before]);
  assertEquals(await enableProjectAutoAdd(target, service.adapter), "endpoint");
  assertEquals(service.counts(), [1, 0]);
  const noop = browser([after]);
  assertEquals(await enableProjectAutoAdd(target, noop.adapter), "unchanged");
  assertEquals(noop.counts(), [0, 0]);
});
Deno.test("auto-add falls back only after a definite protocol rejection", async () => {
  const service = browser([before, before, before], new EndpointUnavailable());
  assertEquals(await enableProjectAutoAdd(target, service.adapter), "browser");
  assertEquals(service.counts(), [1, 1]);
  const direct = browser([before, before]);
  assertEquals(
    await enableProjectAutoAdd(target, direct.adapter, "browser"),
    "browser",
  );
  assertEquals(direct.counts(), [0, 1]);
  const endpoint = browser([before, before, before], new EndpointUnavailable());
  await assertRejects(
    () => enableProjectAutoAdd(target, endpoint.adapter, "endpoint"),
    EndpointUnavailable,
  );
  assertEquals(endpoint.counts(), [1, 0]);
});
Deno.test("auto-add never duplicates an uncertain write or retries access failures", async () => {
  for (
    const error of [
      new UncertainProjectWrite(),
      new Error("HTTP 403"),
      new Error("HTTP 500"),
    ]
  ) {
    const service = browser([before, before, before], error);
    await assertRejects(() => enableProjectAutoAdd(target, service.adapter));
    assertEquals(service.counts(), [1, 0]);
  }
  const lost = browser([before, before, after], new UncertainProjectWrite());
  assertEquals(await enableProjectAutoAdd(target, lost.adapter), "endpoint");
  assertEquals(lost.counts(), [1, 0]);
});
Deno.test("auto-add refuses stale state and requires confirmation after writes", async () => {
  const stale = browser([before, after]);
  await assertRejects(
    () => enableProjectAutoAdd(target, stale.adapter),
    Error,
    "changed during",
  );
  assertEquals(stale.counts(), [0, 0]);
  const different = { ...before, projectId: 124 };
  const changed = browser(
    [before, before, different],
    new EndpointUnavailable(),
  );
  await assertRejects(
    () => enableProjectAutoAdd(target, changed.adapter),
    Error,
    "changed after",
  );
  assertEquals(changed.counts(), [1, 0]);
  const unconfirmed = browser([before, before], undefined, before);
  await assertRejects(
    () => enableProjectAutoAdd(target, unconfirmed.adapter),
    Error,
    "did not confirm",
  );
  assertEquals(
    sameWorkflows(before, { ...before, createUrl: undefined }),
    true,
  );
});
