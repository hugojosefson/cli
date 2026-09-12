import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { builtInFeatureRegistry } from "./built-in-feature-registry.ts";
import { parseFeatures } from "../cli/parse-features.ts";
import { runFeatureOperation } from "../cli/run-features.ts";
import { LocalGithubClient } from "../repository/local-github-client.ts";
import { ProjectFixture } from "../repository/github-default-project-test-fixtures.ts";
import type { FeatureRegistry } from "./feature-registry.ts";

const registry: FeatureRegistry = {
  features: builtInFeatureRegistry.features.filter((feature) =>
    ["github-repo", "github-projects", "github-default-project"].includes(
      feature.metadata.id,
    )
  ),
  capabilities: [],
  presets: [{
    id: "github",
    name: "GitHub",
    summary: "GitHub project defaults",
    changes: builtInFeatureRegistry.presets!.find((preset) =>
      preset.id === "github"
    )!.changes.filter((change) =>
      ["github-repo", "github-projects", "github-default-project"].includes(
        change.featureId,
      )
    ),
  }],
};

async function withProject(
  action: (
    fixture: ProjectFixture,
    run: (...args: string[]) => Promise<string>,
  ) => Promise<void>,
) {
  const path = await Deno.makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-project-",
  });
  const root = new URL(`file://${path}/`);
  const fixture = new ProjectFixture();
  try {
    await action(
      fixture,
      (...args) =>
        runFeatureOperation(
          root,
          parseFeatures(["repo", "features", ...args], registry),
          registry,
          () => [],
          { github: new LocalGithubClient(root, fixture) },
        ),
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

Deno.test("default project lifecycle confirms writes, repairs missing issues, and preserves data on disable", async () => {
  await withProject(async (fixture, run) => {
    await assertRejects(
      () => run("--github-default-project"),
      Error,
      "confirmation",
    );
    assertEquals(fixture.mutations, []);
    assertEquals(fixture.hasProjects, false);
    assertStringIncludes(
      await run("--github-default-project", "--yes"),
      "Applied GitHub changes.",
    );
    assertEquals(fixture.hasProjects, true);
    assertEquals(fixture.projects.length, 1);
    const count = fixture.mutations.length;
    await run("--github-default-project", "--yes");
    assertEquals(fixture.mutations.length, count);
    fixture.issues.push({ id: "new", state: "OPEN" });
    assertStringIncludes(await run(), "drifted");
    await run("--github-default-project", "--yes");
    assertEquals(fixture.items.length, 3);
    await run("--no-github-default-project", "--yes");
    assertEquals(fixture.projects.length, 1);
    assertEquals(fixture.items.length, 3);
    assertEquals(fixture.hasProjects, true);
    await run("--github-default-project", "--yes");
    assertEquals(fixture.projects.length, 1);
  });
});

Deno.test("GitHub preset includes the default project and allows an explicit opt-out", async () => {
  await withProject(async (fixture, run) => {
    await run("--github", "--no-github-default-project", "--yes");
    assertEquals(fixture.projects, []);
    assertEquals(fixture.hasProjects, true);
    await run("--github", "--yes");
    assertEquals(fixture.projects.length, 1);
    assertEquals(fixture.items.length, 2);
  });
});

Deno.test("default project status previews additive Area repair for each issue without writes", async () => {
  await withProject(async (fixture, run) => {
    await run("--github-default-project", "--yes");
    fixture.areaValues.set("item-open-issue", "docs");
    fixture.areaValues.set("item-closed-issue", "custom");
    fixture.issueLabels.set("closed-issue", ["bug", "area:release"]);
    const count = fixture.mutations.length;
    const output = (await run()).replace(/\s+/g, " ");
    assertStringIncludes(
      output,
      "drifted The default project needs updates. --repair:",
    );
    assertStringIncludes(output, 'Add label "area:docs" to issue #1.');
    assertEquals(output.includes("keep"), false);
    assertEquals(output.includes("project Area for issue #1"), false);
    assertStringIncludes(output, 'Add label "area:custom" to issue #2.');
    assertStringIncludes(
      output,
      'Add "release" to project Area for issue #2.',
    );
    assertEquals(output.includes(" -> "), false);
    assertEquals(output.includes("Reuse repository labels"), false);
    assertEquals(fixture.mutations.length, count);
    assertEquals(fixture.issueLabels.has("open-issue"), false);
    await run("--repair", "--yes");
    assertEquals(fixture.issueLabels.get("open-issue"), ["area:docs"]);
    assertEquals(fixture.issueLabels.get("closed-issue"), [
      "bug",
      "area:release",
      "area:custom",
    ]);
    assertEquals(
      fixture.areaValues.get("item-closed-issue"),
      "custom, release",
    );
    const repaired = await run();
    assertEquals(repaired.includes("drifted"), false);
    assertEquals(repaired.includes("Repair would:"), false);
    const repairedCount = fixture.mutations.length;
    await run("--repair", "--yes");
    assertEquals(fixture.mutations.length, repairedCount);
  });
});

Deno.test("default project repair shows each Area addition once with one short hint and no setup boilerplate", async () => {
  await withProject(async (fixture, run) => {
    fixture.issues = Array.from({ length: 76 }, (_, index) => ({
      id: `issue-${index + 1}`,
      state: "OPEN",
    }));
    await run("--github-default-project", "--yes");
    const areas = new Map([
      [70, ["jsr", "release"]],
      [71, ["cli"]],
      [72, ["cli"]],
      [73, ["cli", "deno"]],
      [74, ["jsr", "release"]],
      [75, ["cli", "deno"]],
      [76, ["jsr", "release"]],
    ]);
    for (const [number, values] of areas) {
      fixture.issueLabels.set(
        `issue-${number}`,
        values.map((area) => `area:${area}`),
      );
    }
    const count = fixture.mutations.length;
    const output = (await run()).replace(/\s+/g, " ");
    for (const [number, values] of areas) {
      const detail = `Add ${
        values.map((value) => JSON.stringify(value)).join(", ")
      } to project Area for issue #${number}.`;
      assertEquals(output.split(detail).length - 1, 1, output);
    }
    assertEquals(output.match(/--repair/g)?.length, 1);
    for (
      const omitted of [
        "Repair:",
        "Repair would:",
        "--github-default-project",
        "Configure the default",
        "Create or reuse",
        "enabled = true",
        "repository-default-project/default",
        "All repository issues",
      ]
    ) {
      assertEquals(output.includes(omitted), false, output);
    }
    assertEquals(fixture.mutations.length, count);
    await assertRejects(
      () => run("--repair"),
      Error,
      "confirmation required: Add",
    );
    assertEquals(fixture.mutations.length, count);
    await run("--repair", "--yes");
    for (const [number, values] of areas) {
      assertEquals(
        fixture.areaValues.get(`item-issue-${number}`),
        values.join(", "),
      );
    }
    assertEquals((await run()).includes("--repair"), false);
  });
});

Deno.test("default project status identifies missing configuration and issues", async () => {
  await withProject(async (fixture, run) => {
    await run("--github-default-project", "--yes");
    fixture.fields = fixture.fields.filter((field) =>
      !["Priority", "Area"].includes(String(field.name))
    );
    fixture.views = [];
    fixture.issues.push({ id: "new", state: "OPEN" });
    const count = fixture.mutations.length;
    const output = (await run()).replace(/\s+/g, " ");
    assertStringIncludes(output, "Create project Priority field.");
    assertStringIncludes(output, "Set up project Board view.");
    assertStringIncludes(output, "Create project Work view.");
    assertStringIncludes(output, "Create project Area text field.");
    assertStringIncludes(output, "Show Area in project Work and Board views.");
    assertStringIncludes(
      output,
      "Add 1 missing repository issue(s) to the project.",
    );
    assertEquals(fixture.mutations.length, count);
  });
});

Deno.test("default project refuses unavailable or conflicting configuration before mutations", async () => {
  await withProject(async (fixture, run) => {
    fixture.fail = "projectsV2(first";
    await assertRejects(
      () => run("--github-default-project", "--yes"),
      Error,
      "ambiguous-feature",
    );
    assertEquals(fixture.hasProjects, false);
    fixture.fail = undefined;
    fixture.projects = [fixture.project(), {
      ...fixture.project(),
      id: "duplicate",
    }];
    await assertRejects(
      () => run("--github-default-project", "--repair", "--yes"),
      Error,
      "ambiguous-feature",
    );
    assertEquals(fixture.mutations, []);
  });
});
