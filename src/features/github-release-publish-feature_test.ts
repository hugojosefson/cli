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
  publishTagArtifact,
} from "./github-release-publish-artifacts.ts";
import {
  githubReleasePublisherFeatures,
  githubReleasePublishJsrFeature,
  githubReleasePublishTagFeature,
} from "./github-release-publish-feature.ts";
import { jsrReleaseArtifact } from "./jsr-release-artifacts.ts";
import { parse } from "yaml";

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
  return { kind: "file", content, digest: "digest", mode: 0o644 };
}

const quiescentGithub: GithubReader = {
  repository: () => Promise.resolve(undefined),
  rulesets: () => Promise.resolve(undefined),
  environments: () => Promise.resolve([]),
  variables: () => Promise.resolve([]),
  secretExists: () => Promise.resolve(undefined),
  resource: () => Promise.resolve(undefined),
  workflowRuns: () => Promise.resolve([]),
};

Deno.test("release workflows have pinned actions, routes, permissions, and concurrency", () => {
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
  assertEquals(
    publishJsrArtifact.content.includes("repository_dispatch"),
    false,
  );
  assertStringIncludes(
    publishGithubArtifact.content,
    "types: [hj-release-publish-tag-success]",
  );
  assertStringIncludes(publishJsrArtifact.content, "id-token: write");
  assertStringIncludes(publishGithubArtifact.content, "contents: write");
  for (const artifact of [publishJsrArtifact, publishGithubArtifact]) {
    assertStringIncludes(artifact.content, "HJ_RELEASE_TAG:");
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

Deno.test("JSR publishing requires member dispatch and uses only the selected tag", () => {
  const workflow = parse(publishJsrArtifact.content);
  assertEquals(workflow.on, {
    workflow_dispatch: {
      inputs: {
        tag: {
          description: "Existing unprefixed SemVer tag",
          required: true,
          type: "string",
        },
      },
    },
  });
  assertEquals(workflow.permissions, { contents: "read", "id-token": "write" });
  assertEquals(
    workflow.concurrency.group,
    "hj-release-publish-jsr-${{ inputs.tag }}",
  );
  const steps = workflow.jobs["publish-jsr"].steps;
  assertEquals(steps[0].with.ref, "${{ inputs.tag }}");
  const publish = steps.at(-1);
  assertEquals(publish.env, {
    GH_TOKEN: "${{ github.token }}",
    GITHUB_REPOSITORY: "${{ github.repository }}",
    HJ_RELEASE_ROUTE: "user",
    HJ_RELEASE_TAG: "${{ inputs.tag }}",
  });
  const github = parse(publishGithubArtifact.content);
  assertEquals(github.on.repository_dispatch, {
    types: ["hj-release-publish-tag-success"],
  });
});

Deno.test("repair replaces the bot-triggered JSR workflow with member dispatch", async () => {
  const previous = publishJsrArtifact.content.replace(
    "on:\n",
    "on:\n  repository_dispatch:\n    types: [hj-release-publish-tag-success]\n",
  );
  const before = context({ [publishJsrArtifact.path]: exact(previous) });
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

Deno.test("JSR publisher migrates exact legacy workflow states without adopting custom data", async () => {
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

Deno.test("JSR publisher plans exact legacy migration and leaves custom or unreadable files untouched", async () => {
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

Deno.test("tag publication has exact dependencies and fails closed when protection is unavailable", async () => {
  assertEquals(
    githubReleasePublishTagFeature.dependencies.requires.map((item) =>
      item.featureId
    ),
    [
      "git",
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

Deno.test("only the JSR publisher contributes the usual-route pre-tag command", () => {
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
    }],
  );
});
