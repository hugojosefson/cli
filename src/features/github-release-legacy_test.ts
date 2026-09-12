import {
  makeTempDir,
  mkdir,
  readTextFile,
  remove,
  writeTextFile,
} from "../testing/files-test-fixtures.ts";
import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import type { OperationContext } from "../api/repository-context.ts";
import { LocalFileReader } from "../repository/local-file-reader.ts";
import { LocalGitReader } from "../repository/local-git-reader.ts";
import {
  applyLocalChangePlan,
  preflightLocalChangePlan,
} from "../operations/local-change-plan.ts";
import {
  inspectLegacyRelease,
  legacyReleaseArtifact,
  legacyReleaseTasks,
} from "./github-release-legacy.ts";
import {
  githubReleasePublisherFeatures,
  githubReleasePublishJsrFeature,
  githubReleasePublishTagFeature,
} from "./github-release-publish-feature.ts";
import { githubCiFeature } from "./github-ci-feature.ts";
import { githubCiArtifacts } from "./github-ci-artifacts.ts";
import { legacyCiCheckCompatibility } from "./github-ci-legacy.ts";
import {
  publishJsrArtifact,
  publishTagArtifact,
} from "./github-release-publish-artifacts.ts";
import { jsrReleaseArtifact } from "./jsr-release-artifacts.ts";

const jsr = githubReleasePublishJsrFeature;
const enabled = ["github-ci", jsr.metadata.id];
function context(
  root: URL,
  statuses: string[] | undefined = [],
): OperationContext {
  return {
    repositoryRoot: root,
    files: new LocalFileReader(root),
    git: new LocalGitReader(root),
    detections: new Map(),
    requestedChanges: [],
    resolvedChanges: enabled.map((featureId) => ({
      featureId,
      enabled: true,
      reason: { kind: "explicit-request" },
    })),
    repair: undefined,
    options: {},
    github: {
      repository: () => Promise.resolve(undefined),
      rulesets: () => Promise.resolve([]),
      environments: () => Promise.resolve([]),
      variables: () => Promise.resolve([]),
      secretExists: () => Promise.resolve(undefined),
      resource: (kind, name) =>
        Promise.resolve(
          kind === "actions-workflow-permission"
            ? {
              kind,
              name,
              definition: { value: true },
              stateDigest: "permission",
            }
            : undefined,
        ),
      workflowRuns: () =>
        Promise.resolve(statuses?.map((status) => ({ status }))),
    },
  };
}
async function fixture(run: (root: URL) => Promise<void>) {
  const dir = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-release-migration-",
  });
  const root = new URL(`file://${dir}/`);
  try {
    await mkdir(new URL(".github/workflows/", root), { recursive: true });
    await writeTextFile(
      new URL(legacyReleaseArtifact.path, root),
      legacyReleaseArtifact.content,
    );
    await writeTextFile(
      new URL(publishTagArtifact.path, root),
      publishTagArtifact.content,
    );
    await writeConfig(root);
    await run(root);
  } finally {
    await remove(dir, { recursive: true });
  }
}
async function writeConfig(root: URL, extra = {}, version = "5.2.0") {
  await writeTextFile(
    new URL("deno.jsonc", root),
    "// Keep this project comment.\n" +
      JSON.stringify(
        {
          name: "@example/example",
          version: "1.2.3",
          tasks: {
            ...legacyReleaseTasks(version),
            custom: "echo preserved",
            ...extra,
          },
        },
        null,
        2,
      ) + "\n",
  );
}

test("git-hj-init release recognition accepts recorded versions and preserves custom bundles", async () => {
  await fixture(async (root) => {
    for (const version of ["1.0.0", "5.2.0", "9.0.1-rc.2"]) {
      await writeConfig(root, {}, version);
      await writeTextFile(
        new URL(legacyReleaseArtifact.path, root),
        legacyReleaseArtifact.content.replaceAll("checkout@v4", "checkout@v8")
          .replaceAll("setup-deno@v2", "setup-deno@v3"),
      );
      assertEquals((await inspectLegacyRelease(context(root))).kind, "exact");
    }
    for (
      const extra of [
        { version: "echo customized" },
        { "release:push": "git push elsewhere" },
        { "release:other": "echo other" },
        { custom: "deno task version" },
        { custom: { dependencies: ["release:run"] } },
        { custom: { command: "deno task git-is-clean" } },
      ]
    ) {
      await writeConfig(root, extra);
      assertEquals((await inspectLegacyRelease(context(root))).kind, "custom");
      assertEquals((await jsr.detect(context(root))).state, "ambiguous");
      assertEquals(
        (await jsr.checkEnable({
          ...context(root),
          repair: { kind: "all-drifted" },
        })).result,
        "blocked",
      );
    }
    await writeConfig(root, {}, "latest");
    assertEquals((await inspectLegacyRelease(context(root))).kind, "custom");
  });
});

test("legacy release rejects edited workflows, missing tasks, and unsafe paths", async () => {
  await fixture(async (root) => {
    const file = new URL(legacyReleaseArtifact.path, root);
    await writeTextFile(
      file,
      legacyReleaseArtifact.content + "# edited\n",
    );
    assertEquals((await jsr.checkEnable(context(root))).result, "blocked");
    await writeTextFile(file, legacyReleaseArtifact.content);
    await writeTextFile(
      new URL("deno.jsonc", root),
      '{"tasks": {"release:run": "custom"}}',
    );
    assertEquals((await jsr.checkEnable(context(root))).result, "blocked");
    await writeConfig(root);
    await remove(file);
    assertEquals((await jsr.checkEnable(context(root))).result, "blocked");
    await mkdir(file);
    assertEquals((await jsr.checkEnable(context(root))).result, "blocked");
  });
});

test("legacy release requires a coordinated selection and idle publishers", async () => {
  await fixture(async (root) => {
    assertEquals((await jsr.detect(context(root))).state, "drifted");
    assertEquals((await jsr.checkDisable(context(root))).result, "blocked");
    for (
      const feature of [
        githubReleasePublishTagFeature,
        ...githubReleasePublisherFeatures,
      ]
    ) {
      assertEquals(
        (await feature.checkEnable({ ...context(root), resolvedChanges: [] }))
          .result,
        "blocked",
      );
    }
    assertEquals(
      (await jsr.checkEnable({
        ...context(root),
        resolvedChanges: context(root).resolvedChanges.filter((c) =>
          c.featureId !== "github-ci"
        ),
      })).result,
      "blocked",
    );
    await remove(new URL(publishTagArtifact.path, root));
    assertEquals((await jsr.checkEnable(context(root))).result, "blocked");
    await writeTextFile(
      new URL(publishTagArtifact.path, root),
      publishTagArtifact.content,
    );
    for (const statuses of [["queued"], ["in_progress"], ["waiting"]]) {
      assertEquals(
        (await jsr.checkEnable(context(root, statuses))).result,
        "blocked",
      );
    }
    assertEquals(
      (await jsr.checkEnable({
        ...context(root),
        github: {
          ...context(root).github!,
          workflowRuns: () => Promise.resolve(undefined),
        },
      })).result,
      "blocked",
    );
    assertEquals(
      (await jsr.checkEnable(context(root, ["completed"]))).result,
      "allowed",
    );
  });
});

test("legacy release rejects edited destination collisions even during repair", async () => {
  await fixture(async (root) => {
    for (
      const artifact of [
        publishTagArtifact,
        publishJsrArtifact,
        jsrReleaseArtifact,
        ...githubCiArtifacts,
      ]
    ) {
      await writeTextFile(
        new URL(artifact.path, root),
        artifact.content + "# preserve this\n",
      );
      assertEquals(
        (await jsr.checkEnable({
          ...context(root),
          repair: { kind: "all-drifted" },
        })).result,
        "blocked",
      );
      await assertRejects(() =>
        jsr.planEnable(context(root), {
          result: "allowed",
          warnings: [],
          preconditions: [],
        })
      );
      await remove(new URL(artifact.path, root));
      if (artifact === publishTagArtifact) {
        await writeTextFile(
          new URL(artifact.path, root),
          artifact.content,
        );
      }
    }
  });
});

test("legacy release migration replaces exact collisions and retains checks and unrelated JSONC", async () => {
  for (const collision of [false, true]) {
    await fixture(async (root) => {
      if (collision) {
        for (
          const artifact of [
            publishJsrArtifact,
            jsrReleaseArtifact,
            ...githubCiArtifacts,
          ]
        ) {
          await writeTextFile(
            new URL(artifact.path, root),
            artifact.content,
          );
        }
      }
      const ctx = context(root);
      const releaseCheck = await jsr.checkEnable(ctx);
      const ciCheck = await githubCiFeature.checkEnable(ctx);
      if (
        releaseCheck.result !== "allowed" || ciCheck.result !== "allowed"
      ) throw new Error("Expected both migration plans");
      const releasePlan = await jsr.planEnable(ctx, releaseCheck);
      const ciPlan = await githubCiFeature.planEnable(ctx, ciCheck);
      assertStringIncludes(releasePlan.summary, "release.yaml");
      assertEquals(
        releasePlan.changes.filter((c) => c.kind === "remove-json").length,
        8,
      );
      await preflightLocalChangePlan(root, releasePlan);
      await applyLocalChangePlan(root, ciPlan);
      // A prerequisite may update unrelated config fields before release migration.
      const configPath = new URL("deno.jsonc", root);
      await writeTextFile(
        configPath,
        (await readTextFile(configPath)).replace('"1.2.3"', '"1.2.4"'),
      );
      await applyLocalChangePlan(root, releasePlan);
      assertEquals(await ctx.files.exists(legacyReleaseArtifact.path), false);
      assertEquals(await ctx.files.exists(jsrReleaseArtifact.path), false);
      assertEquals((await jsr.detect(context(root))).state, "enabled");
      assertEquals((await jsr.checkEnable(context(root))).result, "no-op");
      assertEquals(
        (await githubCiFeature.detect(context(root))).state,
        "enabled",
      );
      const config = await readTextFile(configPath);
      assertStringIncludes(config, "// Keep this project comment.");
      assertStringIncludes(config, '"custom": "echo preserved"');
      assertStringIncludes(config, '"version": "1.2.4"');
      assertEquals(config.includes("release:"), false);
      const ci = await readTextFile(
        new URL(githubCiArtifacts[0].path, root),
      );
      assertStringIncludes(ci, legacyCiCheckCompatibility);
      assertStringIncludes(ci, "  check:\n");
      assertStringIncludes(ci, "  hj-release-commit-validation:\n");
    });
  }
});

test("legacy release plans reject changed tasks and workflows before any write", async () => {
  for (
    const path of [
      "deno.jsonc",
      legacyReleaseArtifact.path,
      publishTagArtifact.path,
    ]
  ) {
    await fixture(async (root) => {
      const ctx = context(root);
      const check = await jsr.checkEnable(ctx);
      if (check.result !== "allowed") throw new Error("Expected migration");
      const plan = await jsr.planEnable(ctx, check);
      const url = new URL(path, root);
      await writeTextFile(
        url,
        (await readTextFile(url)).replace(
          path === "deno.jsonc"
            ? "git push origin main"
            : path === publishTagArtifact.path
            ? "name: Publish release tag"
            : "name: release",
          "custom replacement",
        ),
      );
      await assertRejects(() => applyLocalChangePlan(root, plan));
      assertEquals(await ctx.files.exists(publishJsrArtifact.path), false);
      assertEquals(await ctx.files.exists(legacyReleaseArtifact.path), true);
    });
  }
});

test("legacy release selection migrates through feature resolution without repair", async () => {
  const { runFeatureOperation } = await import("../cli/run-features.ts");
  const { parseFeatures } = await import("../cli/parse-features.ts");
  await fixture(async (root) => {
    for (const artifact of githubCiArtifacts) {
      await writeTextFile(new URL(artifact.path, root), artifact.content);
    }
    const registry = {
      features: [githubCiFeature, jsr].map((feature) => ({
        ...feature,
        dependencies: { requires: [] },
      })),
      capabilities: [],
    };
    const request = parseFeatures([
      "repo",
      "features",
      "--github-ci",
      "--github-release-publish-jsr",
    ], registry);
    await runFeatureOperation(root, request, registry, undefined, {
      github: {
        ...context(root).github!,
        upsertResources: () => Promise.resolve(),
        deleteResources: () => Promise.resolve(),
      },
    });
    assertEquals((await inspectLegacyRelease(context(root))).kind, "absent");
    assertEquals((await jsr.detect(context(root))).state, "enabled");
    assertEquals(
      (await githubCiFeature.detect(context(root))).state,
      "enabled",
    );
  });
});
