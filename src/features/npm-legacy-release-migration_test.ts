import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import {
  makeTempDir,
  mkdir,
  remove,
  writeTextFile,
} from "../testing/files-test-fixtures.ts";
import { assertEquals, assertStringIncludes } from "@std/assert";
import type { OperationContext } from "../api/repository-context.ts";
import { LocalFileReader } from "../repository/local-file-reader.ts";
import { LocalGitReader } from "../repository/local-git-reader.ts";
import {
  legacyReleaseArtifact,
  legacyReleaseTasks,
} from "./github-release-legacy.ts";
import {
  publishNpmArtifact,
  publishTagArtifact,
} from "./github-release-publish-artifacts.ts";
import {
  githubReleasePublishJsrFeature,
  githubReleasePublishNpmFeature,
} from "./github-release-publish-feature.ts";

test("npm enablement requires coordinated legacy release migration and preserves its ownership", async () => {
  const path = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "npm-legacy-",
  });
  const root = new URL(`file://${path}/`);
  const npm = githubReleasePublishNpmFeature;
  try {
    await mkdir(new URL(".github/workflows/", root), { recursive: true });
    for (const artifact of [legacyReleaseArtifact, publishTagArtifact]) {
      await writeTextFile(new URL(artifact.path, root), artifact.content);
    }
    await writeTextFile(
      new URL("deno.json", root),
      JSON.stringify({
        name: "@example/package",
        version: "1.0.0",
        tasks: {
          ...legacyReleaseTasks("5.2.0"),
          "npm-build": "deno run build.ts",
        },
      }),
    );
    const context: OperationContext = {
      repositoryRoot: root,
      files: new LocalFileReader(root),
      git: new LocalGitReader(root),
      repair: undefined,
      detections: new Map(),
      requestedChanges: [],
      options: {},
      resolvedChanges: [{
        featureId: npm.metadata.id,
        enabled: true,
        reason: { kind: "explicit-request" },
      }],
    };
    const npmOnly = await npm.checkEnable(context);
    assertEquals(npmOnly.result, "blocked");
    if (npmOnly.result !== "blocked") {
      throw new Error("Expected migration blocker");
    }
    assertStringIncludes(
      npmOnly.blockers[0].message,
      "--github-release-publish-jsr",
    );
    assertEquals(await context.files.exists(publishNpmArtifact.path), false);

    const selection: OperationContext = {
      ...context,
      resolvedChanges: [
        npm.metadata.id,
        "github-release-publish-jsr",
        "github-ci",
        "readme-static",
      ].map((featureId) => ({
        featureId,
        enabled: true,
        reason: { kind: "explicit-request" },
      })),
      github: {
        repository: () => Promise.resolve(undefined),
        rulesets: () => Promise.resolve([]),
        environments: () => Promise.resolve([]),
        variables: () => Promise.resolve([]),
        secretExists: () => Promise.resolve(undefined),
        resource: () => Promise.resolve(undefined),
        workflowRuns: () => Promise.resolve([]),
      },
    };
    const selected = await npm.checkEnable(selection);
    if (selected.result !== "allowed") {
      throw new Error("Expected coordinated enablement");
    }
    const plan = await npm.planEnable(selection, selected);
    assertEquals(
      plan.changes.filter((change) => change.kind === "write-file").map((
        change,
      ) => change.path),
      [publishNpmArtifact.path],
    );
    assertEquals(
      plan.changes.some((change) =>
        change.kind === "remove-file" || change.kind === "remove-json"
      ),
      false,
    );
    const jsr = await githubReleasePublishJsrFeature.checkEnable(selection);
    if (jsr.result !== "allowed") {
      throw new Error("Expected JSR-owned migration");
    }
    const migration = await githubReleasePublishJsrFeature.planEnable(
      selection,
      jsr,
    );
    assertEquals(
      migration.changes.some((change) =>
        change.kind === "remove-file" &&
        change.path === legacyReleaseArtifact.path
      ),
      true,
    );

    const running: OperationContext = {
      ...selection,
      github: {
        ...selection.github!,
        workflowRuns: () => Promise.resolve([{ status: "in_progress" }]),
      },
    };
    assertEquals((await npm.checkEnable(running)).result, "blocked");
    await writeTextFile(
      new URL(legacyReleaseArtifact.path, root),
      legacyReleaseArtifact.content + "# customized\n",
    );
    const custom = await npm.checkEnable(selection);
    assertEquals(custom.result, "blocked");
    assertEquals(await context.files.exists(publishNpmArtifact.path), false);
  } finally {
    await remove(root, { recursive: true });
  }
});
