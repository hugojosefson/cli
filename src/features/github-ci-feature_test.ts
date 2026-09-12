import { hjPackageReference } from "./hj-package.ts";
import { assertEquals, assertStringIncludes } from "@std/assert";
import type { ArtifactObservation } from "../api/artifact-inspection.ts";
import type {
  GithubResource,
  OperationContext,
} from "../api/repository-context.ts";
import { applyLocalChangePlan } from "../operations/local-change-plan.ts";
import { LocalFileReader } from "../repository/local-file-reader.ts";
import { githubCiArtifacts, githubCiMarker } from "./github-ci-artifacts.ts";
import { githubCiFeature } from "./github-ci-feature.ts";

function context(
  observations: Record<string, ArtifactObservation>,
  repair: OperationContext["repair"] = undefined,
  permission: boolean | null = true,
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
    github: github(permission),
    detections: new Map(),
    requestedChanges: [],
    resolvedChanges: [],
    repair,
    options: {},
  };
}

function github(permission: boolean | null) {
  return {
    repository: () => Promise.resolve(undefined),
    rulesets: () => Promise.resolve([]),
    environments: () => Promise.resolve([]),
    variables: () => Promise.resolve([]),
    secretExists: () => Promise.resolve(undefined),
    resource: (
      kind: string,
      name: string,
    ): Promise<GithubResource | undefined> =>
      Promise.resolve(
        kind === "actions-workflow-permission" &&
          name === "can-approve-pull-request-reviews" &&
          permission !== null
          ? {
            kind,
            name,
            definition: { value: permission },
            stateDigest: "permission-digest",
          }
          : undefined,
      ),
  };
}

function exact(
  path: string,
): Extract<ArtifactObservation, { readonly kind: "file" }> {
  const artifact = githubCiArtifacts.find((item) => item.path === path)!;
  return {
    kind: "file",
    content: artifact.content,
    digest: `${path}-digest`,
    mode: 0o644,
  };
}

Deno.test("github-ci owns deterministic pull-request and dependency workflows", () => {
  const ci = githubCiArtifacts[0].content;
  const deps = githubCiArtifacts[1].content;
  assertStringIncludes(ci, "pull_request:");
  assertStringIncludes(ci, "deno task all");
  assertStringIncludes(ci, "hj-release-commit-validation:");
  assertStringIncludes(ci, "release publish-tag-prepare");
  assertStringIncludes(ci, hjPackageReference);
  assertStringIncludes(ci, "HJ_RELEASE_ROUTE: source-validation");
  assertStringIncludes(
    ci,
    "HJ_SOURCE_BASE_SHA: ${{ github.event.pull_request.base.sha }}",
  );
  assertStringIncludes(
    ci,
    "HJ_SOURCE_HEAD_SHA: ${{ github.event.pull_request.head.sha }}",
  );
  assertStringIncludes(ci, "fetch-depth: 0");
  assertStringIncludes(ci, "persist-credentials: false");
  assertStringIncludes(deps, 'cron: "0 3 * * *"');
  assertStringIncludes(deps, "workflow_dispatch:");
  assertStringIncludes(deps, "deno outdated --recursive --update --latest");
  assertStringIncludes(deps, "git switch --force-create");
  assertStringIncludes(deps, "git diff --cached --quiet");
  assertStringIncludes(deps, "git push --force-with-lease=");
  assertStringIncludes(deps, " \\\n              origin");
  assertStringIncludes(deps, "gh pr list");
  assertStringIncludes(deps, "--state open");
  assertStringIncludes(
    ci,
    "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
  );
  assertStringIncludes(
    ci,
    "denoland/setup-deno@22d081ff2d3a40755e97629de92e3bcbfa7cf2ed",
  );
});

Deno.test("github-ci workflows are valid formatted YAML", async () => {
  const root = await Deno.makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-ci-workflows-",
  });
  try {
    for (const artifact of githubCiArtifacts) {
      const path = `${root}/${artifact.path.split("/").at(-1)}`;
      await Deno.writeTextFile(path, artifact.content);
      const result = await new Deno.Command("deno", {
        args: ["fmt", "--check", path],
      }).output();
      assertEquals(result.success, true);
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("github-ci detects absent, exact, drifted, and custom workflows", async () => {
  assertEquals((await githubCiFeature.detect(context({}))).state, "disabled");
  const adopted = Object.fromEntries(
    githubCiArtifacts.map(({ path }) => [path, exact(path)]),
  );
  assertEquals(
    (await githubCiFeature.detect(context(adopted))).state,
    "enabled",
  );
  const permissionFalse = await githubCiFeature.detect(
    context(adopted, undefined, false),
  );
  assertEquals(permissionFalse.state, "drifted");
  if (permissionFalse.state === "drifted") {
    assertStringIncludes(
      permissionFalse.issues[0].resolution,
      "Allow GitHub Actions to create and approve pull requests",
    );
  }
  assertEquals(
    (await githubCiFeature.detect(context(adopted, undefined, null)))
      .state,
    "ambiguous",
  );
  assertEquals(
    (await githubCiFeature.detect(context({
      ...adopted,
      [githubCiArtifacts[0].path]: {
        ...exact(githubCiArtifacts[0].path),
        mode: 0o664,
      },
    }))).state,
    "enabled",
  );
  assertEquals(
    (await githubCiFeature.detect(context({
      ...adopted,
      [githubCiArtifacts[0].path]: {
        ...exact(githubCiArtifacts[0].path),
        content: `${githubCiMarker}changed\n`,
      },
    }))).state,
    "drifted",
  );
  assertEquals(
    (await githubCiFeature.detect(context({
      ...adopted,
      [githubCiArtifacts[0].path]: {
        ...exact(githubCiArtifacts[0].path),
        content: "name: custom\n",
      },
    }))).state,
    "ambiguous",
  );
  assertEquals(
    (await githubCiFeature.detect(context({
      [githubCiArtifacts[0].path]: exact(githubCiArtifacts[0].path),
    }))).state,
    "drifted",
  );
  assertEquals(
    (await githubCiFeature.checkEnable(context({
      [githubCiArtifacts[0].path]: exact(githubCiArtifacts[0].path),
    }))).result,
    "blocked",
  );
});

Deno.test("github-ci repairs marked drift without replacing custom workflows", async () => {
  const drifted = context({
    [githubCiArtifacts[0].path]: {
      ...exact(githubCiArtifacts[0].path),
      content: `${githubCiMarker}changed\n`,
    },
  }, { kind: "features", featureIds: ["github-ci"] });
  const allowed = await githubCiFeature.checkEnable(drifted);
  assertEquals(allowed.result, "allowed");
  if (allowed.result !== "allowed") {
    throw new Error("test setup requires an allowed repair");
  }
  assertEquals(
    (await githubCiFeature.planEnable(drifted, allowed)).changes.map((item) =>
      item.kind
    ),
    [
      "create-directory",
      "create-directory",
      "write-file",
      "write-file",
    ],
  );
  const custom = await githubCiFeature.checkEnable(context({
    [githubCiArtifacts[0].path]: {
      ...exact(githubCiArtifacts[0].path),
      content: "name: custom\n",
    },
  }));
  assertEquals(custom.result, "blocked");
  const disable = await githubCiFeature.checkDisable(context({
    [githubCiArtifacts[0].path]: {
      ...exact(githubCiArtifacts[0].path),
      content: "name: custom\n",
    },
  }));
  assertEquals(disable.result, "blocked");
  const permission = await githubCiFeature.checkEnable(
    context({}, undefined, false),
  );
  assertEquals(permission.result, "blocked");
  if (permission.result === "blocked") {
    assertStringIncludes(
      permission.blockers[0].resolution,
      "Allow GitHub Actions to create and approve pull requests",
    );
  }
  assertEquals(
    (await githubCiFeature.checkEnable(context({}, undefined, null)))
      .result,
    "blocked",
  );
});

Deno.test("github-ci applies its full lifecycle without touching other workflows", async () => {
  const path = await Deno.makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-github-ci-",
  });
  const root = new URL(`file://${path}/`);
  try {
    await Deno.mkdir(new URL(".github/workflows/", root), { recursive: true });
    const unrelated = new URL(".github/workflows/custom.yaml", root);
    await Deno.writeTextFile(unrelated, "name: Custom\n");
    const actual = contextForRoot(root);
    const enable = await githubCiFeature.checkEnable(actual);
    if (enable.result !== "allowed") {
      throw new Error("test setup requires enable");
    }
    await applyLocalChangePlan(
      root,
      await githubCiFeature.planEnable(actual, enable),
    );
    assertEquals(
      (await githubCiFeature.detect(contextForRoot(root))).state,
      "enabled",
    );
    const disableContext = contextForRoot(root);
    const disable = await githubCiFeature.checkDisable(disableContext);
    if (disable.result !== "allowed") {
      throw new Error("test setup requires disable");
    }
    await applyLocalChangePlan(
      root,
      await githubCiFeature.planDisable(disableContext, disable),
    );
    assertEquals(
      (await githubCiFeature.detect(contextForRoot(root))).state,
      "disabled",
    );
    assertEquals(await Deno.readTextFile(unrelated), "name: Custom\n");
  } finally {
    await Deno.remove(path, { recursive: true });
  }
});

function contextForRoot(root: URL): OperationContext {
  return {
    ...context({}),
    repositoryRoot: root,
    files: new LocalFileReader(root),
  };
}

Deno.test("CI bootstrap source is pinned, detected, repaired, and removable", async () => {
  const revision = "a".repeat(40);
  const bootstrap = {
    ...context({}),
    options: { workflowCli: `github:owner/hj@${revision}` },
  };
  const allowed = await githubCiFeature.checkEnable(bootstrap);
  if (allowed.result !== "allowed") throw new Error("Expected enablement");
  const plan = await githubCiFeature.planEnable(bootstrap, allowed);
  const observations: Record<string, ArtifactObservation> = {};
  for (const change of plan.changes) {
    if (change.kind !== "write-file") continue;
    observations[change.path] = {
      kind: "file",
      content: change.content,
      digest: "pinned",
      mode: 0o644,
    };
  }
  const ci = observations[githubCiArtifacts[0].path];
  if (ci.kind !== "file") throw new Error("Expected workflow");
  assertStringIncludes(
    ci.content,
    `--import-map=https://raw.githubusercontent.com/owner/hj/${revision}/deno.json`,
  );
  assertStringIncludes(
    ci.content,
    `https://raw.githubusercontent.com/owner/hj/${revision}/src/cli/cli.ts`,
  );
  assertEquals(
    (await githubCiFeature.detect(context(observations))).state,
    "enabled",
  );
  assertEquals(
    (await githubCiFeature.checkDisable(context(observations))).result,
    "allowed",
  );
  const registry = {
    ...context(observations),
    options: { workflowCli: "jsr" },
  };
  assertEquals((await githubCiFeature.checkEnable(registry)).result, "blocked");
  const repair = { ...registry, repair: { kind: "all-drifted" as const } };
  const check = await githubCiFeature.checkEnable(repair);
  if (check.result !== "allowed") throw new Error("Expected repair");
  const fixed = await githubCiFeature.planEnable(repair, check);
  assertEquals(
    fixed.changes.filter((change) => change.kind === "write-file").map((
      change,
    ) => change.content),
    [githubCiArtifacts[0].content],
  );
  observations[githubCiArtifacts[0].path] = {
    ...ci,
    content: ci.content + "# custom drift\n",
  };
  assertEquals(
    (await githubCiFeature.detect(context(observations))).state,
    "drifted",
  );
});

Deno.test("workflow source migration reaches enabled features through the CLI operation", async () => {
  const { runFeatureOperation } = await import("../cli/run-features.ts");
  const { parseFeatures } = await import("../cli/parse-features.ts");
  const path = await Deno.makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-bootstrap-cli-",
  });
  const root = new URL(`file://${path}/`);
  const registry = {
    features: [{ ...githubCiFeature, dependencies: { requires: [] } }],
    capabilities: [],
  };
  const services = {
    github: {
      ...github(true),
      upsertResources: () => Promise.resolve(),
      deleteResources: () => Promise.resolve(),
    },
  };
  try {
    const enable = parseFeatures([
      "repo",
      "features",
      "--github-ci",
      `--workflow-cli=github:owner/hj@${"c".repeat(40)}`,
    ], registry);
    await runFeatureOperation(root, enable, registry, undefined, services);
    const file = new URL(githubCiArtifacts[0].path, root);
    assertStringIncludes(
      await Deno.readTextFile(file),
      "# hj-workflow-cli: github:",
    );
    const migrate = parseFeatures([
      "repo",
      "features",
      "--github-ci",
      "--workflow-cli=jsr",
      "--repair",
    ], registry);
    await runFeatureOperation(root, migrate, registry, undefined, services);
    assertEquals(await Deno.readTextFile(file), githubCiArtifacts[0].content);
    const again = await runFeatureOperation(
      root,
      migrate,
      registry,
      undefined,
      services,
    );
    assertStringIncludes(again, "No changes");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("github-ci generates configured Deno pins and preserves them across default changes", async () => {
  const configured = {
    ...context({}),
    options: { defaultDenoVersion: "2.8.1" },
  };
  const check = await githubCiFeature.checkEnable(configured);
  if (check.result !== "allowed") throw new Error("Expected allowed operation");
  const plan = await githubCiFeature.planEnable(configured, check);
  const observations: Record<string, ArtifactObservation> = {};
  for (const change of plan.changes) {
    if (change.kind !== "write-file") continue;
    assertStringIncludes(change.content, "deno-version: 2.8.1");
    observations[change.path] = {
      kind: "file",
      content: change.content,
      digest: change.path,
      mode: 0o644,
    };
  }
  assertEquals(Object.keys(observations).length, 2);
  assertEquals(
    (await githubCiFeature.detect(context(observations))).state,
    "enabled",
  );
  assertEquals(
    (await githubCiFeature.checkEnable({
      ...context(observations),
      options: { defaultDenoVersion: "2.9.0" },
    })).result,
    "no-op",
  );
  const explicit = {
    ...context(observations, { kind: "all-drifted" }),
    options: { denoVersion: "2.9.0", defaultDenoVersion: "2.8.1" },
  };
  const repair = await githubCiFeature.checkEnable(explicit);
  if (repair.result !== "allowed") throw new Error("Expected allowed repair");
  const repairPlan = await githubCiFeature.planEnable(explicit, repair);
  for (const change of repairPlan.changes) {
    if (change.kind === "write-file") {
      assertStringIncludes(change.content, "deno-version: 2.9.0");
    }
  }
  const changed = { ...observations };
  const ci = changed[githubCiArtifacts[0].path];
  if (ci.kind !== "file") throw new Error("Expected file");
  changed[githubCiArtifacts[0].path] = {
    ...ci,
    content: ci.content.replace("deno-version: 2.8.1", "deno-version: 2.7.0"),
  };
  assertEquals(
    (await githubCiFeature.detect(context(changed))).state,
    "drifted",
  );
  changed[githubCiArtifacts[0].path] = {
    ...ci,
    content: ci.content.replace("contents: read", "contents: write"),
  };
  assertEquals(
    (await githubCiFeature.detect(context(changed))).state,
    "drifted",
  );
});

Deno.test("invalid recorded Deno versions are drift instead of configuration errors", async () => {
  const observations = Object.fromEntries(
    githubCiArtifacts.map((artifact) => [artifact.path, {
      ...exact(artifact.path),
      content: artifact.content.replaceAll(
        /deno-version: [0-9.]+/g,
        "deno-version: 02.8.1",
      ),
    }]),
  );
  assertEquals(
    (await githubCiFeature.detect(context(observations))).state,
    "drifted",
  );
});
