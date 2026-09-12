import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import { hjPackageReference } from "./hj-package.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import type { ArtifactObservation } from "../api/artifact-inspection.ts";
import type {
  GithubReader,
  OperationContext,
} from "../api/repository-context.ts";
import {
  publishGithubArtifact,
  publishJsrArtifact,
  publishNpmArtifact,
  publishTagArtifact,
} from "./github-release-publish-artifacts.ts";
import {
  githubReleasePublisherFeatures,
  githubReleasePublishJsrFeature,
  githubReleasePublishNpmFeature,
  githubReleasePublishTagFeature,
} from "./github-release-publish-feature.ts";
import { parse } from "yaml";
import { jsrReleaseArtifact } from "./jsr-release-artifacts.ts";
import {
  githubCiArtifacts,
  inspectGithubCiArtifacts,
} from "./github-ci-artifacts.ts";
import { inspectReleaseArtifact } from "./github-release-publish-artifacts.ts";

function context(
  observations: Record<string, ArtifactObservation>,
): OperationContext {
  return {
    repositoryRoot: new URL("file:///work/repository/"),
    files: {
      observe: (path) =>
        Promise.resolve(observations[path] ?? { kind: "absent" }),
      exists: () => Promise.resolve(false),
      readText: () => Promise.resolve(undefined),
      readJson: () => Promise.resolve(undefined),
      digest: () => Promise.resolve(undefined),
      directoryStateDigest: () => Promise.resolve(undefined),
      mode: () => Promise.resolve(undefined),
    },
    git: {
      isRepository: () => Promise.resolve(false),
      head: () => Promise.resolve(undefined),
      status: () => Promise.resolve({ isClean: true, changedPaths: [] }),
      remotes: () => Promise.resolve([]),
      defaultBranch: () => Promise.resolve(undefined),
    },
    detections: new Map(),
    requestedChanges: [],
    resolvedChanges: [],
    repair: undefined,
    options: {},
  };
}
function exact(content: string): ArtifactObservation {
  return {
    kind: "file",
    content,
    digest: "digest",
    mode: 0o644,
    // Workflow detection intentionally depends on content, even on read-only storage.
    access: { readable: true, writable: false, executable: false, shift: 6 },
  };
}

test("workflow detection preserves exact registry pins and rejects other drift", async () => {
  const prefix = hjPackageReference.slice(
    0,
    hjPackageReference.lastIndexOf("@") + 1,
  );
  const releases = [
    { artifact: publishTagArtifact, feature: githubReleasePublishTagFeature },
    { artifact: publishJsrArtifact, feature: githubReleasePublishJsrFeature },
    {
      artifact: publishGithubArtifact,
      feature: githubReleasePublisherFeatures[1],
    },
  ];
  const artifacts = [
    ...githubCiArtifacts,
    ...releases.map(({ artifact }) => artifact),
  ];
  for (const version of ["0.0.1", "12.3.4", "1.2.3-rc.1+build"]) {
    const observations = Object.fromEntries(
      artifacts.map((
        artifact,
      ) => [
        artifact.path,
        exact(
          artifact.content.replaceAll(hjPackageReference, prefix + version),
        ),
      ]),
    );
    const ctx = context(observations);
    const ci = await inspectGithubCiArtifacts(ctx);
    assertEquals(ci.every((item) => item.result === "matches"), true);
    for (const { artifact, feature } of releases) {
      assertEquals((await feature.detect(ctx)).state, "enabled");
      const selected: OperationContext = {
        ...ctx,
        options: { workflowCli: "jsr" },
      };
      const current = await inspectReleaseArtifact(selected, artifact);
      assertEquals(
        current.schema.kind === "file" && current.schema.content,
        artifact.content,
      );
      const altered = context({
        ...observations,
        [artifact.path]: exact(
          artifact.content.replaceAll(hjPackageReference, prefix + version)
            .replace("timeout-minutes: 30", "timeout-minutes: 31"),
        ),
      });
      assertEquals((await feature.detect(altered)).state, "drifted");
    }
  }
  const inconsistent = publishTagArtifact.content.replace(
    hjPackageReference,
    prefix + "0.0.1",
  );
  assertEquals(
    (await githubReleasePublishTagFeature.detect(
      context({ [publishTagArtifact.path]: exact(inconsistent) }),
    )).state,
    "drifted",
  );
  for (const pin of ["latest", "^0.2.0", "01.2.3", "1.2.3;exit"]) {
    const ctx = context({
      [publishJsrArtifact.path]: exact(
        publishJsrArtifact.content.replaceAll(hjPackageReference, prefix + pin),
      ),
    });
    assertEquals(
      (await githubReleasePublishJsrFeature.detect(ctx)).state,
      "drifted",
    );
  }
});

const quiescentGithub: GithubReader = {
  repository: () => Promise.resolve(undefined),
  rulesets: () => Promise.resolve(undefined),
  environments: () => Promise.resolve([]),
  variables: () => Promise.resolve([]),
  secretExists: () => Promise.resolve(undefined),
  resource: () => Promise.resolve(undefined),
  workflowRuns: () => Promise.resolve([]),
};

test("release workflows have pinned actions, routes, permissions, and concurrency", () => {
  for (
    const artifact of [
      publishTagArtifact,
      publishJsrArtifact,
      publishGithubArtifact,
    ]
  ) {
    assertStringIncludes(artifact.content, "persist-credentials: false");
    assertStringIncludes(
      artifact.content,
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
    );
    assertStringIncludes(artifact.content, hjPackageReference);
  }
  assertStringIncludes(publishTagArtifact.content, "release-needed == 'true'");
  assertStringIncludes(publishTagArtifact.content, "branches: [main]");
  assertEquals(
    publishTagArtifact.content.match(/HJ_RELEASE_ROUTE: .*$/gm),
    [
      "HJ_RELEASE_ROUTE: ${{ github.event_name == 'workflow_dispatch' && inputs.tag != '' && 'recovery' || 'usual' }}",
      "HJ_RELEASE_ROUTE: ${{ github.event_name == 'workflow_dispatch' && inputs.tag != '' && 'recovery' || 'usual' }}",
    ],
  );
  assertStringIncludes(
    publishTagArtifact.content,
    "tag:\n        description: Existing or missing release tag\n        required: false\n        type: string",
  );
  assertStringIncludes(publishTagArtifact.content, "HJ_RELEASE_TAG:");
  assertStringIncludes(
    publishTagArtifact.content,
    "GH_TOKEN: ${{ github.token }}",
  );
  assertStringIncludes(publishTagArtifact.content, "gh auth setup-git");
  assertStringIncludes(publishTagArtifact.content, "HJ_RELEASE_BUNDLE:");
  assertStringIncludes(publishTagArtifact.content, "HJ_RELEASE_BUNDLE_DIGEST:");
  assertStringIncludes(publishTagArtifact.content, "checks: write");
  assertStringIncludes(publishTagArtifact.content, "pull-requests: write");
  assertStringIncludes(publishTagArtifact.content, "--allow-run=deno,gh,git");
  assertEquals(publishTagArtifact.content.match(/--allow-read[^\n]*/g), [
    "--allow-read=.,/tmp/opencode",
    "--allow-read=.,/tmp/opencode",
  ]);
  assertStringIncludes(
    publishTagArtifact.content,
    "--allow-write=deno.json,deno.jsonc,CHANGELOG.md,/tmp/opencode,",
  );
  assertStringIncludes(
    publishTagArtifact.content,
    "hj-release-publish-tag-main",
  );
  assertStringIncludes(publishJsrArtifact.content, "repository_dispatch:");
  assertStringIncludes(
    publishJsrArtifact.content,
    "types: [hj-release-publish-tag-success]",
  );
  assertStringIncludes(publishJsrArtifact.content, "id-token: write");
  assertStringIncludes(publishGithubArtifact.content, "contents: write");
  for (const artifact of [publishJsrArtifact, publishGithubArtifact]) {
    assertStringIncludes(artifact.content, "HJ_RELEASE_SCHEMA:");
    assertStringIncludes(artifact.content, "HJ_RELEASE_SHA:");
    assertStringIncludes(artifact.content, "HJ_RELEASE_TAG:");
    assertStringIncludes(artifact.content, "HJ_RELEASE_VERSION:");
    assertStringIncludes(artifact.content, "GH_TOKEN: ${{ github.token }}");
    assertStringIncludes(artifact.content, "gh auth setup-git");
    assertEquals(artifact.content.includes("--token"), false);
  }
  assertStringIncludes(
    publishJsrArtifact.content,
    "--allow-net=api.jsr.io,jsr.io,rekor.sigstore.dev",
  );
  assertEquals(publishJsrArtifact.content.match(/--allow-read[^\n]*/g), [
    "--allow-read=.",
  ]);
  assertStringIncludes(publishJsrArtifact.content, "--allow-run=deno,git");
  assertEquals(publishGithubArtifact.content.match(/--allow-read[^\n]*/g), [
    "--allow-read=.",
  ]);
  assertStringIncludes(publishGithubArtifact.content, "--allow-run=gh,git");
});

test("JSR publisher migrates exact legacy workflow states without adopting custom data", async () => {
  assertEquals(
    (await githubReleasePublishJsrFeature.detect(context({}))).state,
    "disabled",
  );
  assertEquals(
    (await githubReleasePublishJsrFeature.detect(
      context({ [jsrReleaseArtifact.path]: exact(jsrReleaseArtifact.content) }),
    )).state,
    "drifted",
  );
  assertEquals(
    (await githubReleasePublishJsrFeature.detect(
      context({ [publishJsrArtifact.path]: exact(publishJsrArtifact.content) }),
    )).state,
    "enabled",
  );
  assertEquals(
    (await githubReleasePublishJsrFeature.detect(
      context({
        [publishJsrArtifact.path]: exact(publishJsrArtifact.content),
        [jsrReleaseArtifact.path]: exact(jsrReleaseArtifact.content),
      }),
    )).state,
    "drifted",
  );
  assertEquals(
    (await githubReleasePublishJsrFeature.detect(
      context({ [jsrReleaseArtifact.path]: exact("name: Custom\n") }),
    )).state,
    "ambiguous",
  );
});

test("JSR publisher plans exact legacy migration and leaves custom or unreadable files untouched", async () => {
  const allowed = {
    result: "allowed" as const,
    warnings: [],
    preconditions: [],
  };
  const old = exact(jsrReleaseArtifact.content);
  const current = exact(publishJsrArtifact.content);
  const oldOnly = context({ [jsrReleaseArtifact.path]: old });
  assertEquals(
    (await githubReleasePublishJsrFeature.planEnable(oldOnly, allowed)).changes
      .map((change) => change.kind),
    ["create-directory", "create-directory", "write-file", "remove-file"],
  );
  const currentOnly = context({ [publishJsrArtifact.path]: current });
  assertEquals(
    (await githubReleasePublishJsrFeature.checkEnable(currentOnly)).result,
    "no-op",
  );
  const both = {
    ...context({
      ".github": { kind: "directory", stateDigest: "github" },
      ".github/workflows": { kind: "directory", stateDigest: "workflows" },
      [jsrReleaseArtifact.path]: old,
      [publishJsrArtifact.path]: current,
    }),
    github: quiescentGithub,
  };
  assertEquals(
    (await githubReleasePublishJsrFeature.planEnable(both, allowed)).changes,
    [{
      kind: "remove-file",
      path: jsrReleaseArtifact.path,
      expectedDigest: "digest",
    }],
  );
  const markerDrift = context({
    [jsrReleaseArtifact.path]: exact(`${jsrReleaseArtifact.content}# drift\n`),
  });
  assertEquals(
    (await githubReleasePublishJsrFeature.checkEnable(markerDrift)).result,
    "blocked",
  );
  const repair = {
    ...markerDrift,
    repair: {
      kind: "features" as const,
      featureIds: [githubReleasePublishJsrFeature.metadata.id],
    },
  };
  assertEquals(
    (await githubReleasePublishJsrFeature.checkEnable(repair)).result,
    "allowed",
  );
  assertEquals(
    (await githubReleasePublishJsrFeature.planEnable(repair, allowed)).changes
      .map((change) => change.kind),
    ["create-directory", "create-directory", "write-file", "remove-file"],
  );
  const custom = context({
    [jsrReleaseArtifact.path]: exact("name: Custom\n"),
  });
  assertEquals(
    (await githubReleasePublishJsrFeature.checkEnable(custom)).result,
    "blocked",
  );
  const unreadable = context({
    [publishJsrArtifact.path]: { kind: "unreadable", observation: "denied" },
  });
  assertEquals(
    (await githubReleasePublishJsrFeature.checkEnable(unreadable)).result,
    "blocked",
  );
  await assertRejects(() =>
    githubReleasePublishJsrFeature.planDisable(custom, allowed)
  );
  const disableBoth = await githubReleasePublishJsrFeature.planDisable(
    both,
    allowed,
  );
  assertEquals(disableBoth.changes.map((change) => change.kind), [
    "remove-file",
    "remove-file",
  ]);
});

test("tag publication has exact dependencies and fails closed when protection is unavailable", async () => {
  assertEquals(
    githubReleasePublishTagFeature.dependencies.requires.map((item) =>
      item.featureId
    ),
    [
      "git",
      "changelog",
      "github-repo",
      "github-ci",
      "github-main-protection",
      "github-protected-tags",
      "deno-fmt",
    ],
  );
  assertEquals(
    (await githubReleasePublishTagFeature.checkEnable(context({}))).result,
    "blocked",
  );
});

test("only the JSR publisher contributes the usual-route pre-tag command", () => {
  assertEquals(
    githubReleasePublisherFeatures.map((feature) => ({
      id: feature.metadata.id,
      contributions: feature.releaseContributions ?? [],
    })),
    [{
      id: "github-release-publish-jsr",
      contributions: [{
        command: "deno",
        args: ["publish", "--dry-run", "--allow-dirty", "--check=all"],
      }],
    }, {
      id: "github-release-publish-github",
      contributions: [],
    }, {
      id: "github-release-publish-npm",
      contributions: [],
    }],
  );
});

test("JSR publication starts automatically after tag success and supports manual retries", () => {
  const workflow = parse(publishJsrArtifact.content);
  assertEquals(Object.keys(workflow.on).sort(), [
    "repository_dispatch",
    "workflow_dispatch",
  ]);
  assertEquals(workflow.on.repository_dispatch, {
    types: ["hj-release-publish-tag-success"],
  });
  assertEquals(workflow.on.workflow_dispatch.inputs.tag.required, true);
  assertEquals(workflow.permissions, { contents: "read", "id-token": "write" });
  const steps = workflow.jobs["publish-jsr"].steps;
  assertEquals(
    steps[0].with.ref,
    "${{ github.event_name == 'repository_dispatch' && github.event.client_payload.releaseSha || inputs.tag }}",
  );
  assertEquals(
    steps.at(-1).env.HJ_RELEASE_ROUTE,
    "${{ github.event_name == 'repository_dispatch' && 'event' || 'user' }}",
  );
});

test("repair restores automatic publication to a generated manual-only JSR workflow", async () => {
  const manual = publishJsrArtifact.content.replace(
    "  repository_dispatch:\n    types: [hj-release-publish-tag-success]\n",
    "",
  );
  const before = context({ [publishJsrArtifact.path]: exact(manual) });
  assertEquals(
    (await githubReleasePublishJsrFeature.detect(before)).state,
    "drifted",
  );
  assertEquals(
    (await githubReleasePublishJsrFeature.checkEnable(before)).result,
    "blocked",
  );
  const repair: OperationContext = {
    ...before,
    repair: {
      kind: "features",
      featureIds: [githubReleasePublishJsrFeature.metadata.id],
    },
  };
  const allowed = await githubReleasePublishJsrFeature.checkEnable(repair);
  if (allowed.result !== "allowed") {
    throw new Error("Expected repair to be allowed");
  }
  const plan = await githubReleasePublishJsrFeature.planEnable(repair, allowed);
  const write = plan.changes.find((change) => change.kind === "write-file");
  assertEquals(write?.content, publishJsrArtifact.content);
  assertEquals(write?.expectedDigest, "digest");
});

test("JSR publisher creates a pinned bootstrap workflow and restores registry loading", async () => {
  const source = `github:owner/hj@${"b".repeat(40)}`;
  const bootstrap = { ...context({}), options: { workflowCli: source } };
  const allowed = await githubReleasePublishJsrFeature.checkEnable(bootstrap);
  if (allowed.result !== "allowed") throw new Error("Expected enablement");
  const plan = await githubReleasePublishJsrFeature.planEnable(
    bootstrap,
    allowed,
  );
  const write = plan.changes.find((change) => change.kind === "write-file")!;
  assertStringIncludes(write.content, `# hj-workflow-cli: ${source}`);
  const observed = { [write.path]: exact(write.content) };
  const detected = context(observed);
  assertEquals(
    (await githubReleasePublishJsrFeature.detect(detected)).state,
    "enabled",
  );
  const same = await githubReleasePublishJsrFeature.checkEnable(detected);
  assertEquals(same.result, "no-op");
  const remove = { ...detected, github: quiescentGithub };
  assertEquals(
    (await githubReleasePublishJsrFeature.checkDisable(remove)).result,
    "allowed",
  );
  const registry = {
    ...detected,
    options: { workflowCli: "jsr" },
    repair: { kind: "all-drifted" as const },
  };
  const check = await githubReleasePublishJsrFeature.checkEnable(registry);
  if (check.result !== "allowed") throw new Error("Expected repair");
  const fixed = await githubReleasePublishJsrFeature.planEnable(
    registry,
    check,
  );
  const replacement = fixed.changes.find((change) =>
    change.kind === "write-file"
  )!;
  assertEquals(replacement.content, publishJsrArtifact.content);
  const invalid = context({
    [write.path]: exact(write.content.replace(source, "github:owner/hj@main")),
  });
  assertEquals(
    (await githubReleasePublishJsrFeature.detect(invalid)).state,
    "drifted",
  );
});

test("release workflows use configured Deno versions without changing CLI source selection", async () => {
  const source = "github:owner/project@" + "a".repeat(40);
  for (
    const artifact of [
      publishTagArtifact,
      publishJsrArtifact,
      publishGithubArtifact,
    ]
  ) {
    const configured = {
      ...context({}),
      options: { defaultDenoVersion: "2.8.1", workflowCli: source },
    };
    const generated = await inspectReleaseArtifact(configured, artifact);
    if (generated.schema.kind !== "file") {
      throw new Error("Expected file schema");
    }
    assertStringIncludes(generated.schema.content, "deno-version: 2.8.1");
    assertStringIncludes(generated.schema.content, "cache-hash: deno-2.8.1-");
    assertStringIncludes(
      generated.schema.content,
      "# hj-workflow-cli: " + source,
    );
    const saved = context({ [artifact.path]: exact(generated.schema.content) });
    assertEquals(
      (await inspectReleaseArtifact(saved, artifact)).result,
      "matches",
    );
    assertEquals(
      (await inspectReleaseArtifact({
        ...saved,
        options: { defaultDenoVersion: "2.9.0" },
      } as OperationContext, artifact)).result,
      "matches",
    );
    const overridden = await inspectReleaseArtifact({
      ...saved,
      options: { denoVersion: "2.9.0" },
    } as OperationContext, artifact);
    if (overridden.schema.kind !== "file") {
      throw new Error("Expected file schema");
    }
    assertStringIncludes(overridden.schema.content, "deno-version: 2.9.0");
    assertStringIncludes(overridden.schema.content, "cache-hash: deno-2.9.0-");
  }
});

test("npm workflow lifecycle preserves custom files and requires quiescence for removal", async () => {
  const feature = githubReleasePublishNpmFeature;
  const empty = context({});
  assertEquals((await feature.detect(empty)).state, "disabled");
  const allowed = await feature.checkEnable(empty);
  if (allowed.result !== "allowed") throw new Error("Expected enablement");
  const plan = await feature.planEnable(empty, allowed);
  const write = plan.changes.find((change) => change.kind === "write-file")!;
  assertEquals(write.path, publishNpmArtifact.path);
  const saved = context({ [write.path]: exact(write.content) });
  assertEquals((await feature.detect(saved)).state, "enabled");
  assertEquals((await feature.checkEnable(saved)).result, "no-op");
  assertEquals((await feature.checkDisable(saved)).result, "blocked");
  const removable = { ...saved, github: quiescentGithub };
  const remove = await feature.checkDisable(removable);
  if (remove.result !== "allowed") throw new Error("Expected removal");
  assertEquals(
    (await feature.planDisable(removable, remove)).changes[0].kind,
    "remove-file",
  );
  const custom = context({ [write.path]: exact("name: custom\n") });
  assertEquals((await feature.detect(custom)).state, "ambiguous");
  assertEquals((await feature.checkEnable(custom)).result, "blocked");
  const drift = context({ [write.path]: exact(write.content + "# drift\n") });
  assertEquals((await feature.detect(drift)).state, "drifted");
  assertEquals((await feature.checkEnable(drift)).result, "blocked");
  assertEquals(
    (await feature.checkEnable({ ...drift, repair: { kind: "all-drifted" } }))
      .result,
    "allowed",
  );
});

test("npm workflow authenticates independently after tag success and accepts manual retries", () => {
  const workflow = parse(publishNpmArtifact.content);
  assertEquals(workflow.on.repository_dispatch.types, [
    "hj-release-publish-tag-success",
  ]);
  assertEquals(workflow.on.workflow_dispatch.inputs.tag.required, true);
  assertEquals(workflow.permissions, { contents: "read", "id-token": "write" });
  assertEquals(workflow.concurrency["cancel-in-progress"], false);
  const steps = workflow.jobs["publish-npm"].steps;
  assertStringIncludes(steps[0].with.ref, "releaseSha");
  assertEquals(
    steps.find((step: { env?: Record<string, string> }) =>
      step.env?.NODE_AUTH_TOKEN
    ).env.NODE_AUTH_TOKEN,
    "${{ secrets.NPM_TOKEN }}",
  );
  assertStringIncludes(steps.at(-1).run, "--allow-run=deno,git,npm");
  assertStringIncludes(steps.at(-1).run, "release publish-npm");
  assertEquals(publishTagArtifact.content.includes("NPM_TOKEN"), false);
  assertEquals(publishTagArtifact.content.includes("npm-build"), false);
});

test("release task templates detect missing PATH and tar grants as repairable drift", async () => {
  for (
    const artifact of [
      publishTagArtifact,
      publishJsrArtifact,
      publishNpmArtifact,
    ]
  ) {
    assertStringIncludes(artifact.content, "--allow-env=PATH,");
    const legacy = artifact.content.replaceAll(
      "--allow-env=PATH,",
      "--allow-env=",
    );
    const saved = context({ [artifact.path]: exact(legacy) });
    const older = context({
      [artifact.path]: exact(
        legacy.replace(
          "--allow-run=deno,git,npm,tar",
          "--allow-run=deno,git,npm",
        ),
      ),
    });
    assertEquals(
      (await inspectReleaseArtifact(older, artifact)).result,
      "differs",
    );
    assertEquals(
      (await inspectReleaseArtifact(saved, artifact)).result,
      "differs",
    );
    assertEquals(
      (await inspectReleaseArtifact({
        ...saved,
        options: { workflowCli: "jsr" },
      } as OperationContext, artifact)).result,
      "differs",
    );
    const changed = context({
      [artifact.path]: exact(
        legacy.replace("--allow-env=", "--allow-env=UNEXPECTED,"),
      ),
    });
    assertEquals(
      (await inspectReleaseArtifact(changed, artifact)).result,
      "differs",
    );
  }
});

test("managed workflows cache downloads while preserving execution and exact repair", async () => {
  for (
    const artifact of [
      ...githubCiArtifacts,
      publishTagArtifact,
      publishJsrArtifact,
      publishGithubArtifact,
      publishNpmArtifact,
    ]
  ) {
    const workflow = parse(artifact.content);
    for (
      const job of Object.values(workflow.jobs) as {
        steps: { uses?: string; with?: Record<string, unknown> }[];
      }[]
    ) {
      for (const step of job.steps) {
        if (!step.uses?.startsWith("denoland/setup-deno@")) continue;
        assertEquals(step.with?.cache, true);
        assertStringIncludes(
          String(step.with?.["cache-hash"]),
          "hashFiles('**/deno.lock', 'toolchain.json')",
        );
        assertEquals(
          String(step.with?.["cache-hash"]).includes("deno.json"),
          false,
        );
        assertEquals(
          String(step.with?.["cache-hash"]).includes("github.sha"),
          false,
        );
      }
    }
  }
  const tag = parse(publishTagArtifact.content);
  const npm = tag.jobs["publish-tag-prepare"].steps.find((
    step: { name?: string },
  ) => step.name === "Cache native test npm downloads");
  assertEquals(npm.with.path, "~/.npm");
  assertEquals(
    npm.if,
    "hashFiles('scripts/test-build/dependencies/package-lock.json') != '' && hashFiles('scripts/test-build/tools/package-lock.json') != ''",
  );
  assertEquals(
    tag.jobs["publish-tag-apply"].steps.some((step: { name?: string }) =>
      step.name === npm.name
    ),
    false,
  );
  const before = publishTagArtifact.content.replaceAll(
    "          cache: true\n",
    "",
  );
  const inspection = await inspectReleaseArtifact(
    context({ [publishTagArtifact.path]: exact(before) }),
    publishTagArtifact,
  );
  assertEquals(inspection.result, "differs");
  if (inspection.schema.kind !== "file") {
    throw new Error("Expected file schema");
  }
  const { describeFileRepair } = await import("../cli/describe-file-repair.ts");
  const details = describeFileRepair(
    publishTagArtifact.path,
    before,
    inspection.schema.content,
  ).join("\n");
  assertStringIncludes(details, "cache = true");
  assertStringIncludes(details, publishTagArtifact.path);
});
