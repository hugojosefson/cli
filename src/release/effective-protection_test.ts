import { assertEquals, assertStringIncludes } from "@std/assert";
import type {
  GithubProtection,
  GithubResource,
} from "../api/repository-context.ts";
import type { JsonObject } from "../api/json.ts";
import {
  mainProtectionDefinition,
  protectedTagsDefinition,
  releaseTagsDefinition,
} from "../features/github-protection-definitions.ts";
import {
  evaluateReleaseProtection,
  projectRulesets,
} from "./effective-protection.ts";

const input = {
  defaultBranch: "main",
  releaseBranch: "release-1.2.3",
  releaseTag: "1.2.3",
};

Deno.test("effective protection accepts the exact release configuration", () => {
  assertEquals(evaluateReleaseProtection(exactProtection(), input), {
    kind: "compatible",
  });
});

Deno.test("release-first collision requires strict source status checks", () => {
  const weakened = {
    ...mainProtectionDefinition,
    rules: (mainProtectionDefinition.rules as readonly JsonObject[]).map((
      rule,
    ) =>
      rule.type === "required_status_checks"
        ? {
          ...rule,
          parameters: {
            ...(rule.parameters as JsonObject),
            strict_required_status_checks_policy: false,
          },
        }
        : rule
    ),
  };
  const protection = exactProtection();
  const result = evaluateReleaseProtection({
    ...protection,
    rulesets: protection.rulesets.map((ruleset) =>
      ruleset.name === "hj/github-main-protection"
        ? resource(weakened, ruleset.name)
        : ruleset
    ),
  }, input);
  if (result.kind !== "incompatible") throw new Error("expected rejection");
  assertStringIncludes(result.reasons.join("\n"), "not strict");
});

Deno.test("effective protection fails closed for extra main requirements", () => {
  const approval = branchRuleset("external/approval", [{
    type: "pull_request",
    parameters: {
      allowed_merge_methods: ["rebase"],
      dismiss_stale_reviews_on_push: false,
      require_code_owner_review: false,
      require_extra_approval_for_unattributed_changes: false,
      require_last_push_approval: false,
      required_approving_review_count: 1,
      required_review_thread_resolution: true,
      required_reviewers: [],
    },
  }], ["~DEFAULT_BRANCH"]);
  const extraCheck = branchRuleset("external/check", [{
    type: "required_status_checks",
    parameters: {
      do_not_enforce_on_create: false,
      required_status_checks: [{ context: "deploy", integration_id: 15368 }],
      strict_required_status_checks_policy: true,
    },
  }], ["~DEFAULT_BRANCH"]);
  const result = evaluateReleaseProtection(
    withRules(exactProtection(), approval, extraCheck),
    input,
  );
  if (result.kind !== "incompatible") throw new Error("expected rejection");
  assertStringIncludes(result.reasons.join("\n"), "requires approvals");
  assertStringIncludes(result.reasons.join("\n"), "only the two hj checks");
});

Deno.test("effective protection proves release branch and tag actor behavior", () => {
  const branchBlock = branchRuleset(
    "external/branches",
    [{ type: "creation" }],
    ["refs/heads/release-*"],
  );
  const tagBlock = tagRuleset(
    "external/tags",
    [{ type: "creation" }],
    ["refs/tags/*"],
  );
  const result = evaluateReleaseProtection(
    withRules(exactProtection(), branchBlock, tagBlock),
    input,
  );
  if (result.kind !== "incompatible") throw new Error("expected rejection");
  assertStringIncludes(result.reasons.join("\n"), "blocks the release branch");
  assertStringIncludes(
    result.reasons.join("\n"),
    "blocks release-tag creation",
  );

  const bypassedBranch = {
    ...branchBlock,
    definition: {
      ...branchBlock.definition,
      bypass_actors: [{
        actor_id: 15368,
        actor_type: "Integration",
        bypass_mode: "always",
      }],
    },
  };
  assertEquals(
    evaluateReleaseProtection(
      withRules(exactProtection(), bypassedBranch),
      input,
    ),
    { kind: "compatible" },
  );
});

Deno.test("effective protection rejects unavailable and unknown data", () => {
  const noSource = {
    ...exactProtection(),
    rulesets: exactProtection().rulesets.map(({ source: _source, ...item }) =>
      item
    ),
  };
  const sourceResult = evaluateReleaseProtection(noSource, input);
  if (sourceResult.kind !== "incompatible") {
    throw new Error("expected rejection");
  }
  assertStringIncludes(sourceResult.reasons.join("\n"), "source data");

  const unknown = branchRuleset(
    "external/unknown",
    [{ type: "required_deployments" }],
    ["~DEFAULT_BRANCH"],
  );
  const unknownResult = evaluateReleaseProtection(
    withRules(exactProtection(), unknown),
    input,
  );
  if (unknownResult.kind !== "incompatible") {
    throw new Error("expected rejection");
  }
  assertStringIncludes(
    unknownResult.reasons.join("\n"),
    "unsupported main rule",
  );
});

Deno.test("projected rulesets replace only local rules", () => {
  const protection = exactProtection();
  const projected = projectRulesets(
    protection,
    new Map([
      ["hj/github-main-protection", undefined],
      ["new/rule", mainProtectionDefinition],
    ]),
  );
  assertEquals(
    projected.rulesets.map((item) => item.name).sort(),
    ["hj/github-protected-tags", "hj/github-release-tags", "new/rule"],
  );
});

function exactProtection(): GithubProtection {
  return {
    repository: {
      allow_auto_merge: true,
      allow_merge_commit: true,
      allow_rebase_merge: true,
      allow_squash_merge: true,
    },
    actions: { can_approve_pull_request_reviews: true },
    legacyBranchProtection: undefined,
    rulesets: [
      resource(mainProtectionDefinition, "hj/github-main-protection"),
      resource(protectedTagsDefinition, "hj/github-protected-tags"),
      resource(releaseTagsDefinition, "hj/github-release-tags"),
    ],
  };
}

function withRules(
  protection: GithubProtection,
  ...rulesets: GithubResource[]
): GithubProtection {
  return { ...protection, rulesets: [...protection.rulesets, ...rulesets] };
}

function branchRuleset(
  name: string,
  rules: readonly JsonObject[],
  include: readonly string[],
): GithubResource {
  return resource({
    bypass_actors: [],
    conditions: { ref_name: { exclude: [], include } },
    enforcement: "active",
    name,
    rules,
    target: "branch",
  }, name);
}

function tagRuleset(
  name: string,
  rules: readonly JsonObject[],
  include: readonly string[],
): GithubResource {
  return resource({
    bypass_actors: [],
    conditions: { ref_name: { exclude: [], include } },
    enforcement: "active",
    name,
    rules,
    target: "tag",
  }, name);
}

function resource(
  definition: JsonObject,
  name: string,
): GithubResource {
  return {
    kind: "repository-ruleset",
    name,
    definition,
    stateDigest: name,
    source: "owner/repo",
    sourceType: "Repository",
  };
}
