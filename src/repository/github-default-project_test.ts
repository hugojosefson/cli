import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import {
  defaultProjectName,
  defaultProjectResource,
  GithubDefaultProjectClient,
} from "./github-default-project.ts";
import {
  projectConnection,
  ProjectFixture,
} from "./github-default-project-test-fixtures.ts";
import { LocalGithubClient } from "./local-github-client.ts";

const client = (fixture: ProjectFixture) =>
  new GithubDefaultProjectClient(fixture, { owner: "owner", name: "repo" });
async function apply(fixture: ProjectFixture, enabled = true) {
  const github = client(fixture);
  const resource = await github.resource();
  await github.upsert({
    resource: defaultProjectResource,
    name: defaultProjectName,
    definition: { enabled },
    expectedStateDigest: resource.stateDigest,
  });
}

Deno.test("default project creates, links, organizes every issue, and reuses setup", async () => {
  const fixture = new ProjectFixture();
  assertEquals((await client(fixture).resource()).definition.projectId, null);
  await apply(fixture);
  assertEquals(fixture.projects.length, 1);
  assertEquals(fixture.projects[0].title, "repo");
  assertEquals(fixture.items.map((item) => item.content?.id).sort(), [
    "closed-issue",
    "open-issue",
  ]);
  assertEquals(fixture.assignments.map(({ option }) => option).sort(), [
    "done",
    "todo",
  ]);
  assertEquals(fixture.fields.map(({ name }) => name), [
    "Status",
    "Priority",
    "Area",
  ]);
  assertEquals((await client(fixture).resource()).definition.missingIssues, 0);
  const before = fixture.mutations.length;
  await apply(fixture);
  assertEquals(fixture.mutations.length, before);
  await apply(fixture, false);
  assertEquals((await client(fixture).resource()).definition.linked, false);
  assertEquals(fixture.items.length, 2);
  await apply(fixture);
  assertEquals(fixture.projects.length, 1);
  assertEquals((await client(fixture).resource()).definition.linked, true);
});

Deno.test("default project preserves existing fields, items, and custom project titles", async () => {
  const fixture = new ProjectFixture();
  fixture.projects = [fixture.project("Development")];
  fixture.fields.push({
    id: "priority",
    name: "Priority",
    options: [{ id: "custom", name: "Urgent" }],
  });
  fixture.items = [{ content: { id: "open-issue" } }, { content: null }, {
    content: { id: "another-repo-issue" },
  }];
  await apply(fixture);
  assertEquals(fixture.assignments.length, 1);
  assertEquals(fixture.assignments[0].option, "done");
  assertEquals(fixture.projects[0].title, "Development");
  assertEquals(fixture.fields[1].options, [{ id: "custom", name: "Urgent" }]);
  assertEquals(fixture.items.length, 4);
});

Deno.test("default project rejects ambiguity, closed projects, and conflicting fields before writes", async () => {
  for (
    const setup of [
      (f: ProjectFixture) => {
        f.projects.push({ ...f.project(), id: "duplicate" });
      },
      (f: ProjectFixture) => {
        f.projects[0].closed = true;
      },
      (f: ProjectFixture) => {
        f.fields.push({ id: "priority", name: "Priority" });
      },
      (f: ProjectFixture) => {
        f.fields.push({ id: "status2", name: "Status", options: [] });
      },
    ]
  ) {
    const fixture = new ProjectFixture();
    fixture.projects = [fixture.project()];
    setup(fixture);
    await assertRejects(
      () => apply(fixture),
      Error,
      "conflicting default GitHub project",
    );
    assertEquals(fixture.mutations, []);
  }
});

Deno.test("default project rejects stale state and unsupported changes", async () => {
  const fixture = new ProjectFixture();
  const github = client(fixture);
  const resource = await github.resource();
  fixture.projects.push(fixture.project());
  await assertRejects(
    () =>
      github.upsert({
        resource: defaultProjectResource,
        name: "default",
        definition: { enabled: true },
        expectedStateDigest: resource.stateDigest,
      }),
    Error,
    "precondition failed",
  );
  await assertRejects(
    () =>
      github.upsert({
        resource: defaultProjectResource,
        name: "other",
        definition: { enabled: true },
        expectedStateDigest: resource.stateDigest,
      }),
    Error,
    "unsupported",
  );
  assertEquals(fixture.mutations, []);
});

Deno.test("default project retries partial setup without duplicates", async () => {
  const fixture = new ProjectFixture();
  fixture.fail = "createProjectV2Field(input";
  await assertRejects(() => apply(fixture), Error, "project access");
  assertEquals(fixture.projects.length, 1);
  fixture.fail = undefined;
  await apply(fixture);
  assertEquals(fixture.projects.length, 1);
  assertEquals(fixture.items.length, 2);
  fixture.issues.push({ id: "new-issue", state: "OPEN" });
  await apply(fixture);
  assertEquals(fixture.items.length, 3);
});

Deno.test("default project paginates all connections and rejects repeated cursors", async () => {
  const fixture = new ProjectFixture();
  fixture.override = (query, variables) => {
    if (!query.includes("projectsV2(first")) return;
    return {
      data: {
        repository: {
          id: "repository",
          owner: {
            id: "owner",
            projectsV2: variables.cursor
              ? projectConnection([fixture.project()])
              : projectConnection([], "next"),
          },
        },
      },
    };
  };
  assertEquals(
    (await client(fixture).resource()).definition.projectId,
    "project",
  );
  fixture.override = (query) =>
    query.includes("projectsV2(first")
      ? {
        data: {
          repository: {
            id: "repository",
            owner: { id: "owner", projectsV2: projectConnection([], "again") },
          },
        },
      }
      : undefined;
  await assertRejects(() => client(fixture).resource(), Error, "Repeated");
});

Deno.test("default project rejects partial, malformed, and unsuccessful API responses", async () => {
  for (
    const response of [
      { data: { repository: null } },
      { data: { repository: {} }, errors: [{ message: "private" }] },
      {
        data: {
          repository: {
            id: "repository",
            owner: { id: "owner", projectsV2: { nodes: [] } },
          },
        },
      },
    ]
  ) {
    const fixture = new ProjectFixture();
    fixture.override = () => response;
    await assertRejects(() => apply(fixture));
    assertEquals(fixture.mutations, []);
  }
  const fixture = new ProjectFixture();
  fixture.projects = [{
    ...fixture.project(),
    repositories: projectConnection([], "more"),
  }];
  await assertRejects(
    () => apply(fixture),
    Error,
    "complete GitHub project repository links",
  );
  fixture.projects = [fixture.project()];
  fixture.issues[0].state = "UNKNOWN";
  await assertRejects(() => apply(fixture), Error, "issue state");
  const unavailable = new GithubDefaultProjectClient({
    run: () => {
      throw new Error("secret");
    },
  }, { owner: "owner", name: "repo" });
  await assertRejects(() => unavailable.resource(), Error, "Could not start");
});

Deno.test("local GitHub adapter exposes project diagnostics and rejects mixed resource batches", async () => {
  const fixture = new ProjectFixture();
  const github = new LocalGithubClient(
    new URL("file:///tmp/opencode/"),
    fixture,
  );
  const resource = await github.resource(defaultProjectResource, "default");
  const change = {
    resource: defaultProjectResource,
    name: "default",
    definition: { enabled: true },
    expectedStateDigest: resource?.stateDigest,
  };
  await assertRejects(
    () => github.upsertResources([change, change]),
    Error,
    "incompatible",
  );
  await github.upsertResources([change]);
  assertEquals(
    (await github.resource(defaultProjectResource, "default"))?.definition
      .linked,
    true,
  );
  assertEquals(
    await github.resource(defaultProjectResource, "other"),
    undefined,
  );
  fixture.fail = "projectsV2(first";
  assertEquals(
    await github.resource(defaultProjectResource, "default"),
    undefined,
  );
  assertStringIncludes(github.diagnostics.join(" "), "gh auth refresh");
});

Deno.test("default project waits for delayed item visibility without repeating writes", async () => {
  const fixture = new ProjectFixture();
  let delayedReads = 0;
  fixture.override = (query) => {
    if (
      query.includes("items(first") && !query.includes("fieldValueByName") &&
      fixture.items.length === 2 &&
      delayedReads++ < 2
    ) {
      return { data: { node: { items: projectConnection([]) } } };
    }
  };
  await apply(fixture);
  assertEquals(
    fixture.mutations.filter((query) =>
      query.includes("addProjectV2ItemById(input")
    ).length,
    2,
  );
  assertEquals(delayedReads, 3);
});

Deno.test("default project supplies absent status fields and preserves custom status options", async () => {
  const fixture = new ProjectFixture();
  fixture.projects = [fixture.project()];
  fixture.fields = [];
  await apply(fixture);
  assertEquals(fixture.fields.map(({ name }) => name), [
    "Status",
    "Priority",
    "Area",
  ]);
  fixture.fields[0].options = [{ id: "waiting", name: "Waiting" }];
  fixture.issues.push({ id: "custom-status", state: "OPEN" });
  const before = fixture.assignments.length;
  await apply(fixture);
  assertEquals(fixture.assignments.length, before);
  assertEquals(fixture.items.length, 3);
});

Deno.test("default project synchronizes issues beyond the first hundred and preserves paginated items", async () => {
  const fixture = new ProjectFixture();
  fixture.projects = [fixture.project()];
  fixture.fields.unshift({
    id: "priority",
    name: "Priority",
    options: [{ id: "p1", name: "P1" }],
  });
  fixture.issues = Array.from(
    { length: 103 },
    (_, n) => ({ id: `issue-${n}`, state: "OPEN" }),
  );
  fixture.items = fixture.issues.slice(0, 102).map(({ id }) => ({
    content: { id },
  }));
  fixture.override = (query, variables) => {
    const page = (items: unknown[], size = 100) =>
      variables.cursor
        ? projectConnection(items.slice(size))
        : projectConnection(items.slice(0, size), "next");
    if (query.includes("fields(first") && !query.includes("views(first")) {
      return { data: { node: { fields: page(fixture.fields, 1) } } };
    }
    if (query.includes("issues(first")) {
      return { data: { repository: { issues: page(fixture.issues) } } };
    }
    if (query.includes("items(first") && !query.includes("fieldValueByName")) {
      return { data: { node: { items: page(fixture.items) } } };
    }
  };
  await apply(fixture);
  assertEquals(fixture.items.length, 103);
  assertEquals(fixture.assignments.length, 1);
  assertEquals(fixture.assignments[0].item, "item-issue-102");
  assertEquals(
    fixture.mutations.filter((query) =>
      query.includes("addProjectV2ItemById(input")
    ).length,
    1,
  );
});

Deno.test("default project starts on Board and preserves status IDs when adding Backlog", async () => {
  const fixture = new ProjectFixture();
  await apply(fixture);
  assertEquals(fixture.views.map((view) => [view.name, view.layout]), [[
    "Board",
    "BOARD_LAYOUT",
  ], ["Work", "TABLE_LAYOUT"]]);
  const status = fixture.fields.find((field) => field.name === "Status")!;
  assertEquals(
    (status.options as { id: string; name: string }[]).map((
      option,
    ) => [option.id, option.name]),
    [["backlog", "Backlog"], ["todo", "Todo"], ["progress", "In Progress"], [
      "done",
      "Done",
    ]],
  );
  assertEquals(
    (await client(fixture).resource()).definition.boardUrl,
    "https://github.com/users/owner/projects/1/views/1",
  );
});

Deno.test("default project keeps custom views and moves Backlog without replacing options", async () => {
  const fixture = new ProjectFixture();
  fixture.projects = [fixture.project()];
  fixture.fields.unshift({ id: "title", name: "Title" });
  const status = fixture.fields.find((field) => field.name === "Status")!;
  const backlog = {
    id: "later",
    name: "Backlog",
    color: "BLUE",
    description: "Keep this wording",
  };
  (status.options as unknown[]).push(backlog);
  fixture.views = [{
    id: "work",
    number: 1,
    name: "Work",
    layout: "TABLE_LAYOUT",
    filter: "is:open",
    fieldIds: ["title", "status"],
  }];
  await apply(fixture);
  assertEquals(fixture.views[0], {
    id: "work",
    number: 1,
    name: "Work",
    layout: "TABLE_LAYOUT",
    filter: "is:open",
    fieldIds: ["title", "area", "status"],
  });
  assertEquals(fixture.views[1].name, "Board");
  assertEquals((status.options as unknown[])[0], backlog);
  const before = fixture.mutations.length;
  await apply(fixture);
  assertEquals(fixture.mutations.length, before);
});

Deno.test("default project repairs areas by adding values and labels without removing either", async () => {
  const fixture = new ProjectFixture();
  fixture.issueLabels.set("open-issue", [
    "area:github",
    "enhancement",
    "area:cli",
    "area:github",
  ]);
  fixture.issueLabels.set("closed-issue", ["area:docs"]);
  await apply(fixture);
  assertEquals(fixture.areaValues.get("item-open-issue"), "cli, github");
  assertEquals(fixture.areaValues.get("item-closed-issue"), "docs");
  fixture.issueLabels.set("open-issue", ["area:release", "enhancement"]);
  fixture.issueLabels.set("closed-issue", []);
  assertEquals((await client(fixture).resource()).definition.areaReady, false);
  const assignments = [...fixture.assignments];
  await apply(fixture);
  assertEquals(
    fixture.areaValues.get("item-open-issue"),
    "cli, github, release",
  );
  assertEquals(fixture.areaValues.get("item-closed-issue"), "docs");
  assertEquals(fixture.issueLabels.get("open-issue"), [
    "area:release",
    "enhancement",
    "area:cli",
    "area:github",
  ]);
  assertEquals(fixture.issueLabels.get("closed-issue"), ["area:docs"]);
  assertEquals(fixture.assignments, assignments);
  const before = fixture.mutations.length;
  await apply(fixture);
  assertEquals(fixture.mutations.length, before);
});

Deno.test("default project reuses repository labels and creates new areas once for multiple issues", async () => {
  const fixture = new ProjectFixture();
  await apply(fixture);
  fixture.repositoryLabels.set("area:Docs", "existing-docs");
  fixture.areaValues.set("item-open-issue", "docs, custom");
  fixture.areaValues.set("item-closed-issue", "custom");
  fixture.issueLabels.set("open-issue", ["bug"]);
  const assignments = [...fixture.assignments];
  await apply(fixture);
  assertEquals(fixture.areaValues.get("item-open-issue"), "docs, custom");
  assertEquals(fixture.areaValues.get("item-closed-issue"), "custom");
  assertEquals(fixture.issueLabels.get("open-issue"), [
    "bug",
    "area:Docs",
    "area:custom",
  ]);
  assertEquals(fixture.issueLabels.get("closed-issue"), ["area:custom"]);
  assertEquals(fixture.repositoryLabels.get("area:Docs"), "existing-docs");
  assertEquals(
    fixture.mutations.filter((query) => query.includes("createLabel(input"))
      .length,
    1,
  );
  assertEquals((await client(fixture).resource()).definition.areaReady, true);
  assertEquals(fixture.assignments, assignments);
  const before = fixture.mutations.length;
  await apply(fixture);
  assertEquals(fixture.mutations.length, before);
});

Deno.test("default project retries a failed label assignment without losing areas or duplicating labels", async () => {
  const fixture = new ProjectFixture();
  await apply(fixture);
  fixture.areaValues.set("item-open-issue", "docs");
  fixture.issueLabels.set("open-issue", ["bug", "area:cli"]);
  fixture.fail = "addLabelsToLabelable";
  await assertRejects(() => apply(fixture));
  assertEquals(fixture.areaValues.get("item-open-issue"), "docs");
  assertEquals(fixture.issueLabels.get("open-issue"), ["bug", "area:cli"]);
  assertEquals((await client(fixture).resource()).definition.areaReady, false);
  fixture.fail = undefined;
  await apply(fixture);
  assertEquals(fixture.areaValues.get("item-open-issue"), "cli, docs");
  assertEquals(fixture.issueLabels.get("open-issue"), [
    "bug",
    "area:cli",
    "area:docs",
  ]);
  assertEquals(
    fixture.mutations.filter((query) => query.includes("createLabel(input"))
      .length,
    1,
  );
});

Deno.test("default project rereads uncertain label creation and rejects unavailable labels", async () => {
  for (const created of [true, false]) {
    const fixture = new ProjectFixture();
    await apply(fixture);
    fixture.areaValues.set("item-open-issue", "docs");
    fixture.override = (query) => {
      if (query.includes("createLabel(input")) {
        if (created) fixture.repositoryLabels.set("area:docs", "raced-label");
        return { errors: [{ message: "Creation response lost" }] };
      }
    };
    if (created) {
      await apply(fixture);
      assertEquals(fixture.issueLabels.get("open-issue"), ["area:docs"]);
      assertEquals(
        (await client(fixture).resource()).definition.areaReady,
        true,
      );
    } else {
      await assertRejects(() => apply(fixture));
      assertEquals(fixture.issueLabels.has("open-issue"), false);
    }
    assertEquals(fixture.areaValues.get("item-open-issue"), "docs");
  }
});

Deno.test("default project refuses incomplete label lookups before creating labels", async () => {
  const fixture = new ProjectFixture();
  await apply(fixture);
  fixture.areaValues.set("item-open-issue", "docs");
  const before = fixture.mutations.length;
  fixture.override = (query) => {
    if (query.includes("label(name:$label)")) {
      return { data: { repository: { id: "repository" } } };
    }
  };
  await assertRejects(
    () => apply(fixture),
    Error,
    "Cannot read GitHub Area data",
  );
  assertEquals(fixture.mutations.length, before);
});

Deno.test("default project rejects conflicting Area and Board definitions", async () => {
  for (
    const configure of [
      (f: ProjectFixture) =>
        f.fields.push({
          id: "area",
          name: "Area",
          options: [{ id: "a", name: "Custom" }],
        }),
      (f: ProjectFixture) =>
        f.views.push({
          id: "custom",
          number: 2,
          name: "Board",
          layout: "TABLE_LAYOUT",
          filter: "custom",
        }),
      (f: ProjectFixture) => {
        (f.fields[0].options as unknown[]).push({ id: "todo2", name: "Todo" });
      },
    ]
  ) {
    const fixture = new ProjectFixture();
    fixture.projects = [fixture.project()];
    configure(fixture);
    await assertRejects(
      () => apply(fixture),
      Error,
      "conflicting default GitHub project",
    );
    assertEquals(fixture.mutations.length, 0);
  }
});
