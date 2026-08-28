import { assertEquals, assertRejects } from "@std/assert";
import type { FeatureDetection } from "../api/feature-detection.ts";
import type { JsonObject } from "../api/json.ts";
import type {
  GithubResource,
  OperationContext,
} from "../api/repository-context.ts";
import { builtInFeatureRegistry } from "./built-in-feature-registry.ts";
import {
  mainProtectionDefinition,
  mainReviewDefinition,
  protectedTagsDefinition,
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
      rulesets: () => Promise.resolve(rulesets),
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

Deno.test("protection definitions match accepted GitHub payloads", () => {
  assertEquals(mainProtectionDefinition, {
    bypass_actors: [],
    conditions: { ref_name: { exclude: [], include: ["~DEFAULT_BRANCH"] } },
    enforcement: "active",
    name: "hj/github-main-protection",
    rules: [
      {
        parameters: {
          allowed_merge_methods: ["merge", "rebase", "squash"],
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
          required_status_checks: [{ context: "check", integration_id: 15368 }],
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
    conditions: { ref_name: { exclude: [], include: ["~ALL"] } },
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
});

Deno.test("protected tags adopt exact state and preserve unrelated rulesets", async () => {
  const initial = context([]);
  const allowed = await githubProtectedTagsFeature.checkEnable(initial);
  if (allowed.result !== "allowed") throw new Error("expected allowed");
  const plan = await githubProtectedTagsFeature.planEnable(initial, allowed);
  const exact = resource(protectedTagsDefinition, "one", 1);
  assertEquals(
    (await githubProtectedTagsFeature.detect(context([exact]))).state,
    "enabled",
  );
  assertEquals(
    (await githubProtectedTagsFeature.checkEnable(context([exact]))).result,
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
  assertEquals(plan.changes.length, 1);
  assertEquals(
    (plan.changes[0] as { name: string }).name,
    "hj/github-protected-tags",
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
  assertEquals(plan.preconditions, [{
    kind: "github-resource-state",
    resource: "repository-ruleset",
    name: "hj/github-main-protection",
    stateDigest: "drift",
  }]);
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
  };
}
