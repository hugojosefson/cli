import { assertEquals, assertRejects } from "@std/assert";
import type { FeatureDetection } from "../api/feature-detection.ts";
import type { JsonObject } from "../api/json.ts";
import type {
  GithubResource,
  OperationContext,
} from "../api/repository-context.ts";
import { builtInFeatureRegistry } from "./built-in-feature-registry.ts";
import { githubCiArtifacts } from "./github-ci-artifacts.ts";
import {
  mainProtectionDefinition,
  mainReviewDefinition,
  protectedTagsDefinition,
  protectedTagsGuardDefinition,
  releaseTagsDefinition,
} from "./github-protection-definitions.ts";
import {
  githubMainProtectionFeature,
  githubMainReviewFeature,
  githubProtectedTagsFeature,
} from "./github-protection-features.ts";
import { resolveFeatureChanges } from "./resolve-feature-changes.ts";

function context(
  rulesets: readonly GithubResource[] | undefined,
  repair?: OperationContext["repair"],
): OperationContext {
  return {
    repositoryRoot: new URL("file:///work/"),
    files: {
      observe: () => Promise.resolve({ kind: "absent" }),
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
    github: {
      repository: () => Promise.resolve({ owner: "owner", name: "repo" }),
      remoteFile: (path) =>
        Promise.resolve(
          githubCiArtifacts.find((item) => item.path === path)
            ? {
              kind: "file" as const,
              content: githubCiArtifacts.find((item) => item.path === path)!
                .content,
            }
            : { kind: "absent" as const },
        ),
      workflowRuns: () => Promise.resolve([]),
      openPullRequests: () => Promise.resolve([]),
      branches: () => Promise.resolve([]),
      tags: () => Promise.resolve([]),
      defaultBranchCommits: () => Promise.resolve([]),
      rulesets: () => Promise.resolve(rulesets),
      tagRulesetEligibility: () => Promise.resolve("eligible"),
      environments: () => Promise.resolve([]),
      variables: () => Promise.resolve([]),
      secretExists: () => Promise.resolve(undefined),
      resource: () => Promise.resolve(undefined),
    },
    detections: new Map(),
    requestedChanges: [],
    resolvedChanges: [],
    repair,
    options: {},
  };
}

Deno.test("main protection plans generated CI and a separate review bypass", async () => {
  const mainContext = context([]);
  const mainAllowed = await githubMainProtectionFeature.checkEnable(
    mainContext,
  );
  if (mainAllowed.result !== "allowed") throw new Error("expected allowed");
  const main = await githubMainProtectionFeature.planEnable(
    mainContext,
    mainAllowed,
  );
  assertEquals(main.changes, [{
    kind: "upsert-github-resource",
    resource: "repository-ruleset",
    name: "hj/github-main-protection",
    definition: mainProtectionDefinition,
    expectedStateDigest: undefined,
  }]);
  assertEquals(main.preconditions, [{
    kind: "github-resource-state",
    resource: "repository-ruleset",
    name: "hj/github-main-protection",
    stateDigest: undefined,
  }, {
    kind: "github-remote-file",
    path: githubCiArtifacts[0].path,
    expectedContent: githubCiArtifacts[0].content,
  }]);

  const reviewContext = context([]);
  const reviewAllowed = await githubMainReviewFeature.checkEnable(
    reviewContext,
  );
  if (reviewAllowed.result !== "allowed") throw new Error("expected allowed");
  const review = await githubMainReviewFeature.planEnable(
    reviewContext,
    reviewAllowed,
  );
  assertEquals(review.changes, [{
    kind: "upsert-github-resource",
    resource: "repository-ruleset",
    name: "hj/github-main-review",
    definition: mainReviewDefinition,
    expectedStateDigest: undefined,
  }]);
});

Deno.test("main protection requires exact CI on the remote default branch", async () => {
  for (
    const remote of [{ kind: "absent" as const }, {
      kind: "file" as const,
      content: "custom\n",
    }, undefined]
  ) {
    const operation = context([]);
    operation.github!.remoteFile = () => Promise.resolve(remote);
    const check = await githubMainProtectionFeature.checkEnable(operation);
    assertEquals(check.result, "blocked");
    if (check.result === "blocked") {
      assertEquals(check.blockers[0].code, "github-remote-ci-missing");
    }
  }
});

Deno.test("main protection replanning rejects a changed remote CI workflow", async () => {
  const operation = context([]);
  let reads = 0;
  operation.github!.remoteFile = () =>
    Promise.resolve(
      reads++ === 0
        ? { kind: "file", content: githubCiArtifacts[0].content }
        : { kind: "file", content: "changed\n" },
    );
  const allowed = await githubMainProtectionFeature.checkEnable(operation);
  if (allowed.result !== "allowed") throw new Error("expected allowed");
  await assertRejects(() =>
    githubMainProtectionFeature.planEnable(operation, allowed)
  );
});

Deno.test("protection definitions match accepted GitHub payloads", () => {
  assertEquals(mainProtectionDefinition, {
    bypass_actors: [],
    conditions: { ref_name: { exclude: [], include: ["~DEFAULT_BRANCH"] } },
    enforcement: "active",
    name: "hj/github-main-protection",
    rules: [
      {
        parameters: {
          allowed_merge_methods: ["rebase"],
          dismiss_stale_reviews_on_push: false,
          require_code_owner_review: false,
          require_extra_approval_for_unattributed_changes: false,
          require_last_push_approval: false,
          required_approving_review_count: 0,
          required_review_thread_resolution: true,
          required_reviewers: [],
        },
        type: "pull_request",
      },
      {
        parameters: {
          do_not_enforce_on_create: false,
          required_status_checks: [
            { context: "check", integration_id: 15368 },
            {
              context: "hj-release-commit-validation",
              integration_id: 15368,
            },
          ],
          strict_required_status_checks_policy: true,
        },
        type: "required_status_checks",
      },
      { type: "deletion" },
      { type: "non_fast_forward" },
    ],
    target: "branch",
  });
  assertEquals(protectedTagsDefinition, {
    bypass_actors: [{
      actor_id: 5,
      actor_type: "RepositoryRole",
      bypass_mode: "always",
    }],
    conditions: {
      ref_name: {
        exclude: ["refs/tags/[0-9]*.[0-9]*.[0-9]*"],
        include: ["~ALL"],
      },
    },
    enforcement: "active",
    name: "hj/github-protected-tags",
    rules: [
      { type: "creation" },
      { type: "deletion" },
      { type: "non_fast_forward" },
      { type: "update" },
    ],
    target: "tag",
  });
  assertEquals(releaseTagsDefinition, {
    bypass_actors: [{
      actor_id: 5,
      actor_type: "RepositoryRole",
      bypass_mode: "always",
    }],
    conditions: {
      ref_name: {
        exclude: [],
        include: ["refs/tags/[0-9]*.[0-9]*.[0-9]*"],
      },
    },
    enforcement: "active",
    name: "hj/github-release-tags",
    rules: [
      { type: "deletion" },
      { type: "non_fast_forward" },
      { type: "update" },
    ],
    target: "tag",
  });
});

Deno.test("protected tags adopt exact state and preserve unrelated rulesets", async () => {
  const initial = context([]);
  const allowed = await githubProtectedTagsFeature.checkEnable(initial);
  if (allowed.result !== "allowed") throw new Error("expected allowed");
  const plan = await githubProtectedTagsFeature.planEnable(initial, allowed);
  const exact = resource(protectedTagsDefinition, "one", 1);
  const release = resource(releaseTagsDefinition, "two", 2);
  assertEquals(
    (await githubProtectedTagsFeature.detect(context([exact, release]))).state,
    "enabled",
  );
  assertEquals(
    (await githubProtectedTagsFeature.checkEnable(context([exact, release])))
      .result,
    "no-op",
  );

  const unrelated = resource(
    {
      ...protectedTagsDefinition,
      name: "custom/protected-tags",
    },
    "custom",
    2,
  );
  assertEquals(
    (await githubProtectedTagsFeature.detect(context([unrelated]))).state,
    "disabled",
  );
  assertEquals(plan.changes, [{
    kind: "github-ruleset-transition",
    steps: [
      {
        change: {
          kind: "upsert",
          name: "hj/github-protected-tags",
          definition: protectedTagsGuardDefinition,
        },
        before: [
          { name: "hj/github-protected-tags" },
          { name: "hj/github-release-tags" },
        ],
        after: [
          {
            name: "hj/github-protected-tags",
            definition: protectedTagsGuardDefinition,
          },
          { name: "hj/github-release-tags" },
        ],
      },
      {
        change: {
          kind: "upsert",
          name: "hj/github-release-tags",
          definition: releaseTagsDefinition,
        },
        before: [
          {
            name: "hj/github-protected-tags",
            definition: protectedTagsGuardDefinition,
          },
          { name: "hj/github-release-tags" },
        ],
        after: [
          {
            name: "hj/github-protected-tags",
            definition: protectedTagsGuardDefinition,
          },
          { name: "hj/github-release-tags", definition: releaseTagsDefinition },
        ],
      },
      {
        change: {
          kind: "upsert",
          name: "hj/github-protected-tags",
          definition: protectedTagsDefinition,
        },
        before: [
          {
            name: "hj/github-protected-tags",
            definition: protectedTagsGuardDefinition,
          },
          { name: "hj/github-release-tags", definition: releaseTagsDefinition },
        ],
        after: [
          {
            name: "hj/github-protected-tags",
            definition: protectedTagsDefinition,
          },
          { name: "hj/github-release-tags", definition: releaseTagsDefinition },
        ],
      },
    ],
  }]);
});

Deno.test("protected tags resume guarded transitions and reject unsafe reserved state", async () => {
  const guard = resource(protectedTagsGuardDefinition, "guard", 1);
  const release = resource(releaseTagsDefinition, "release", 2);
  const enableAllowed = await githubProtectedTagsFeature.checkEnable(
    context([guard]),
  );
  if (enableAllowed.result !== "allowed") throw new Error("expected allowed");
  const enable = await githubProtectedTagsFeature.planEnable(
    context([guard]),
    enableAllowed,
  );
  assertEquals(
    (enable.changes[0] as { steps: readonly { change: { name: string } }[] })
      .steps.map((step) => step.change.name),
    ["hj/github-release-tags", "hj/github-protected-tags"],
  );
  const disableAllowed = await githubProtectedTagsFeature.checkDisable(
    context([guard, release]),
  );
  if (disableAllowed.result !== "allowed") throw new Error("expected allowed");
  const disable = await githubProtectedTagsFeature.planDisable(
    context([guard, release]),
    disableAllowed,
  );
  assertEquals(
    (disable.changes[0] as { steps: readonly { change: { name: string } }[] })
      .steps.map((step) => step.change.name),
    ["hj/github-release-tags", "hj/github-protected-tags"],
  );
  assertEquals(
    (await githubProtectedTagsFeature.checkEnable(context([release]))).result,
    "blocked",
  );
});

Deno.test("unavailable and duplicate reserved rulesets are ambiguous", async () => {
  assertEquals(
    (await githubMainProtectionFeature.detect(context(undefined))).state,
    "ambiguous",
  );
  const duplicate = resource(mainProtectionDefinition, "a", 1);
  assertEquals(
    (await githubMainProtectionFeature.detect(
      context([duplicate, { ...duplicate, stateDigest: "b" }]),
    )).state,
    "ambiguous",
  );
  assertEquals(
    (await githubMainProtectionFeature.detect(
      context([{ ...duplicate, sourceType: "Organization" }]),
    )).state,
    "ambiguous",
  );
});

Deno.test("ruleset drift requires repair and guards replacement", async () => {
  const drift = resource(
    {
      ...mainProtectionDefinition,
      enforcement: "disabled",
    },
    "drift",
    3,
  );
  const withoutRepair = context([drift]);
  assertEquals(
    (await githubMainProtectionFeature.detect(withoutRepair)).state,
    "drifted",
  );
  assertEquals(
    (await githubMainProtectionFeature.checkEnable(withoutRepair)).result,
    "blocked",
  );
  assertEquals(
    (await githubMainProtectionFeature.checkDisable(withoutRepair)).result,
    "blocked",
  );

  const repairing = context([drift], {
    kind: "features",
    featureIds: ["github-main-protection"],
  });
  const allowed = await githubMainProtectionFeature.checkEnable(repairing);
  if (allowed.result !== "allowed") throw new Error("expected repair");
  const plan = await githubMainProtectionFeature.planEnable(repairing, allowed);
  assertEquals(plan.preconditions[0], {
    kind: "github-resource-state",
    resource: "repository-ruleset",
    name: "hj/github-main-protection",
    stateDigest: "drift",
  });
  assertEquals(plan.preconditions[1], {
    kind: "github-remote-file",
    path: githubCiArtifacts[0].path,
    expectedContent: githubCiArtifacts[0].content,
  });
  assertEquals(plan.changes, [{
    kind: "upsert-github-resource",
    resource: "repository-ruleset",
    name: "hj/github-main-protection",
    definition: mainProtectionDefinition,
    expectedStateDigest: "drift",
  }]);
});

Deno.test("planning rejects ruleset state changes after an allowed check", async () => {
  const changing = context([]);
  const duplicate = resource(mainProtectionDefinition, "duplicate", 6);
  let reads = 0;
  changing.github!.rulesets = () =>
    Promise.resolve(reads++ === 0 ? [] : [duplicate, duplicate]);
  const allowed = await githubMainProtectionFeature.checkEnable(changing);
  if (allowed.result !== "allowed") throw new Error("expected allowed");
  await assertRejects(() =>
    githubMainProtectionFeature.planEnable(changing, allowed)
  );
});

Deno.test("disable deletes exact rulesets only with an optimistic guard", async () => {
  const exact = resource(mainReviewDefinition, "exact", 4);
  const exactContext = context([exact]);
  const allowed = await githubMainReviewFeature.checkDisable(exactContext);
  if (allowed.result !== "allowed") throw new Error("expected disable");
  const plan = await githubMainReviewFeature.planDisable(exactContext, allowed);
  assertEquals(plan.changes, [{
    kind: "delete-github-resource",
    resource: "repository-ruleset",
    name: "hj/github-main-review",
    expectedStateDigest: "exact",
  }]);
  assertEquals(plan.preconditions[0], {
    kind: "github-resource-state",
    resource: "repository-ruleset",
    name: "hj/github-main-review",
    stateDigest: "exact",
  });
  assertEquals(
    (await githubMainReviewFeature.checkDisable(context([]))).result,
    "no-op",
  );
});

Deno.test("API-added pull-request defaults participate in exact adoption", async () => {
  const missingDefault = structuredClone(mainProtectionDefinition);
  const pullRequest = (missingDefault.rules as Array<{
    type: string;
    parameters?: Record<string, unknown>;
  }>).find((rule) => rule.type === "pull_request");
  delete pullRequest?.parameters?.required_reviewers;
  assertEquals(
    (await githubMainProtectionFeature.detect(
      context([resource(missingDefault, "missing", 5)]),
    )).state,
    "drifted",
  );
});

Deno.test("protection dependencies and preset remain granular", () => {
  assertEquals(githubMainProtectionFeature.dependencies.requires, [{
    featureId: "github-ci",
    reason: "Main protection requires generated GitHub CI.",
  }]);
  assertEquals(githubMainReviewFeature.dependencies.requires, [{
    featureId: "github-main-protection",
    reason: "Strict reviews layer on main protection.",
  }]);
  assertEquals(githubProtectedTagsFeature.dependencies.requires, [{
    featureId: "github-repo",
    reason: "Tag protection requires a GitHub repository.",
  }]);

  const detections = Object.fromEntries(
    builtInFeatureRegistry.features.map((feature) => [
      feature.metadata.id,
      disabledDetection,
    ]),
  ) as Record<string, FeatureDetection>;
  const resolved = resolveFeatureChanges(builtInFeatureRegistry, detections, {
    changes: [{ featureId: "github-main-review", enabled: false }],
    presets: ["github-protection"],
    applyDefaults: false,
    defaults: [],
  });
  assertEquals(resolved.issues, []);
  const protection = resolved.changes.filter((change) =>
    change.featureId.startsWith("github-main-") ||
    change.featureId === "github-protected-tags"
  ).map((change) => [change.featureId, change.enabled]).sort();
  assertEquals(protection, [
    ["github-main-protection", true],
    ["github-protected-tags", true],
  ]);
  const reviewActive = {
    ...detections,
    "github-main-review": { state: "enabled" as const, evidence: [] },
  };
  const retained = resolveFeatureChanges(builtInFeatureRegistry, reviewActive, {
    changes: [],
    presets: ["github-protection"],
    applyDefaults: false,
    defaults: [],
  });
  assertEquals(retained.issues, []);
  assertEquals(
    retained.changes.map((change) => change.featureId).sort(),
    [
      "deno-fmt",
      "github-ci",
      "github-main-protection",
      "github-protected-tags",
      "github-repo",
    ],
  );
});

const disabledDetection: FeatureDetection = {
  state: "disabled",
  evidence: [],
};

function resource(
  definition: JsonObject,
  stateDigest: string,
  id: number,
): GithubResource {
  return {
    kind: "repository-ruleset",
    name: definition.name as string,
    definition: { ...definition, id },
    stateDigest,
    source: "owner/repo",
    sourceType: "Repository",
  };
}

Deno.test("main protection accepts exact pinned CI and binds its observed source", async () => {
  const { workflowCliArtifact } = await import("./workflow-cli.ts");
  const operation = context([]);
  const pinned = workflowCliArtifact(githubCiArtifacts[0], {
    ...operation,
    options: { workflowCli: `github:owner/hj@${"d".repeat(40)}` },
  } as OperationContext, { kind: "absent" });
  operation.github!.remoteFile = () =>
    Promise.resolve({ kind: "file", content: pinned.content });
  const allowed = await githubMainProtectionFeature.checkEnable(operation);
  if (allowed.result !== "allowed") {
    throw new Error("Expected bootstrap CI to be allowed");
  }
  const plan = await githubMainProtectionFeature.planEnable(operation, allowed);
  assertEquals(plan.preconditions.at(-1), {
    kind: "github-remote-file",
    path: pinned.path,
    expectedContent: pinned.content,
  });
  operation.github!.remoteFile = () =>
    Promise.resolve({ kind: "file", content: pinned.content + "# drift\n" });
  assertEquals(
    (await githubMainProtectionFeature.checkEnable(operation)).result,
    "blocked",
  );
});

Deno.test("main protection accepts migrated CI with recorded pins and rejects custom edits", async () => {
  const { workflowCliArtifact } = await import("./workflow-cli.ts");
  const { legacyCiCheckCompatibility } = await import("./github-ci-legacy.ts");
  const { hjPackageReference } = await import("./hj-package.ts");
  for (const source of ["jsr", `github:owner/hj@${"d".repeat(40)}`]) {
    const operation = context([]);
    const pinned = workflowCliArtifact({
      ...githubCiArtifacts[0],
      content: githubCiArtifacts[0].content + legacyCiCheckCompatibility,
    }, {
      ...operation,
      options: { workflowCli: source, denoVersion: "2.8.1" },
    } as OperationContext, { kind: "absent" });
    const content = pinned.content.replaceAll(
      hjPackageReference,
      hjPackageReference.replace(/@[^@]+$/, "@0.2.0"),
    );
    operation.github!.remoteFile = () =>
      Promise.resolve({ kind: "file", content });
    const allowed = await githubMainProtectionFeature.checkEnable(operation);
    if (allowed.result !== "allowed") {
      throw new Error("Expected exact migrated CI to be allowed");
    }
    const plan = await githubMainProtectionFeature.planEnable(
      operation,
      allowed,
    );
    assertEquals(plan.preconditions.at(-1), {
      kind: "github-remote-file",
      path: pinned.path,
      expectedContent: content,
    });
    for (
      const changed of [
        content + "# user change\n",
        content.replace("needs: check", "needs: custom"),
        content.replace(
          'run: test "$HJ_CHECK_RESULT" = "success"',
          "run: true",
        ),
      ]
    ) {
      operation.github!.remoteFile = () =>
        Promise.resolve({ kind: "file", content: changed });
      assertEquals(
        (await githubMainProtectionFeature.checkEnable(operation)).result,
        "blocked",
      );
      await assertRejects(() =>
        githubMainProtectionFeature.planEnable(operation, allowed)
      );
    }
  }
});
