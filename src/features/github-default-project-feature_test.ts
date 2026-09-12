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
