/** @module Fail-closed evaluation of rules that affect release publication. */

import { applicableRulesets } from "./ruleset-matching.ts";
import {
  optionalEnabled,
  optionalRecord,
  parametersFor,
  record,
  rules,
  stringArray,
} from "./protection-data.ts";
import type {
  GithubProtection,
  GithubResource,
} from "../api/repository-context.ts";
import type { JsonObject } from "../api/json.ts";
import { parseSemver } from "./semver.ts";

const actionsAppId = 15368;
const requiredChecks = new Map([
  ["check", actionsAppId],
  ["hj-release-commit-validation", actionsAppId],
]);
const managedTagRulesets = new Set([
  "hj/github-protected-tags",
  "hj/github-release-tags",
]);

export type ReleaseProtectionInput = {
  readonly defaultBranch: string;
  readonly releaseBranch: string;
  readonly releaseTag: string;
};

export type ReleaseProtectionResult =
  | { readonly kind: "compatible" }
  | { readonly kind: "incompatible"; readonly reasons: readonly string[] };

/** Applies known local ruleset replacements before an effective-state check. */
export function projectRulesets(
  protection: GithubProtection,
  replacements: ReadonlyMap<string, JsonObject | undefined>,
): GithubProtection {
  const retained = protection.rulesets.filter((ruleset) =>
    ruleset.sourceType !== "Repository" || !replacements.has(ruleset.name)
  );
  const projected = [...replacements.entries()].flatMap(
    ([name, definition]): GithubResource[] =>
      definition
        ? [{
          kind: "repository-ruleset",
          name,
          definition,
          stateDigest: "projected",
          sourceType: "Repository",
          source: "projected",
        }]
        : [],
  );
  return { ...protection, rulesets: [...retained, ...projected] };
}

/** Proves the effective main, release-branch, and release-tag rules. */
export function evaluateReleaseProtection(
  protection: GithubProtection,
  input: ReleaseProtectionInput,
): ReleaseProtectionResult {
  const reasons: string[] = [];
  validateSettings(protection, reasons);
  const main = applicableRulesets(
    protection.rulesets,
    "branch",
    `refs/heads/${input.defaultBranch}`,
    input.defaultBranch,
    reasons,
  );
  validateMain(main, protection.legacyBranchProtection, protection, reasons);
  const releaseBranch = applicableRulesets(
    protection.rulesets,
    "branch",
    `refs/heads/${input.releaseBranch}`,
    input.defaultBranch,
    reasons,
  );
  validateReleaseBranch(releaseBranch, reasons);
  const releaseTag = applicableRulesets(
    protection.rulesets,
    "tag",
    `refs/tags/${input.releaseTag}`,
    input.defaultBranch,
    reasons,
  );
  validateReleaseTag(releaseTag, input.releaseTag, reasons);
  return reasons.length
    ? { kind: "incompatible", reasons: [...new Set(reasons)].sort() }
    : { kind: "compatible" };
}

/** Proves only the effective default-branch rules after a protection change. */
export function evaluateMainProtection(
  protection: GithubProtection,
  defaultBranch: string,
): ReleaseProtectionResult {
  const reasons: string[] = [];
  validateSettings(protection, reasons);
  const main = applicableRulesets(
    protection.rulesets,
    "branch",
    `refs/heads/${defaultBranch}`,
    defaultBranch,
    reasons,
  );
  validateMain(main, protection.legacyBranchProtection, protection, reasons);
  return result(reasons);
}

/** Proves only creation and immutability for one SemVer release tag. */
export function evaluateReleaseTagProtection(
  protection: GithubProtection,
  defaultBranch: string,
  tag: string,
): ReleaseProtectionResult {
  const reasons: string[] = [];
  const rulesets = applicableRulesets(
    protection.rulesets,
    "tag",
    `refs/tags/${tag}`,
    defaultBranch,
    reasons,
  );
  validateReleaseTag(rulesets, tag, reasons);
  return result(reasons);
}

function result(reasons: readonly string[]): ReleaseProtectionResult {
  return reasons.length
    ? { kind: "incompatible", reasons: [...new Set(reasons)].sort() }
    : { kind: "compatible" };
}

function validateSettings(
  protection: GithubProtection,
  reasons: string[],
): void {
  if (protection.repository.allow_rebase_merge !== true) {
    reasons.push("The repository does not enable rebase merge.");
  }
  for (const setting of ["allow_squash_merge", "allow_merge_commit"] as const) {
    if (typeof protection.repository[setting] !== "boolean") {
      reasons.push(`Repository setting ${setting} is unavailable.`);
    }
  }
  if (protection.repository.allow_auto_merge !== true) {
    reasons.push("The repository does not enable auto-merge.");
  }
  if (protection.actions.can_approve_pull_request_reviews !== true) {
    reasons.push("GitHub Actions cannot create pull requests.");
  }
}

function validateMain(
  rulesets: readonly GithubResource[],
  legacy: JsonObject | undefined,
  protection: GithubProtection,
  reasons: string[],
): void {
  const checks = new Map<string, Set<number>>();
  let methods = new Set<string>();
  if (protection.repository.allow_merge_commit === true) methods.add("merge");
  if (protection.repository.allow_squash_merge === true) methods.add("squash");
  if (protection.repository.allow_rebase_merge === true) methods.add("rebase");
  let pullRequestRule = false;
  let strict = false;
  for (const ruleset of rulesets) {
    for (const rule of rules(ruleset, reasons)) {
      if (rule.type === "pull_request") {
        pullRequestRule = true;
        const parameters = parametersFor(
          rule,
          pullRequestKeys,
          ruleset,
          reasons,
        );
        if (!parameters) continue;
        validateZeroReviews(parameters, ruleset.name, reasons);
        const allowed = stringArray(parameters.allowed_merge_methods);
        if (
          !allowed || allowed.some((method) => !knownMergeMethods.has(method))
        ) {
          reasons.push(`Ruleset ${ruleset.name} has unknown merge methods.`);
        } else {
          methods = new Set(
            [...methods].filter((method) => allowed.includes(method)),
          );
        }
        continue;
      }
      if (rule.type === "required_status_checks") {
        const parameters = parametersFor(rule, statusKeys, ruleset, reasons);
        if (!parameters) continue;
        strict ||= parameters.strict_required_status_checks_policy === true;
        if (
          typeof parameters.strict_required_status_checks_policy !==
            "boolean" ||
          typeof parameters.do_not_enforce_on_create !== "boolean"
        ) {
          reasons.push(
            `Ruleset ${ruleset.name} has incomplete status parameters.`,
          );
        }
        collectChecks(
          parameters.required_status_checks,
          checks,
          ruleset.name,
          reasons,
        );
        continue;
      }
      if (
        !permittedMainRules.has(rule.type as string) || "parameters" in rule
      ) {
        reasons.push(
          `Ruleset ${ruleset.name} has unsupported main rule ${rule.type}.`,
        );
      }
    }
  }
  validateLegacy(legacy, checks, reasons);
  if (!pullRequestRule) reasons.push("Main does not require a pull request.");
  if (!strict) reasons.push("Main status checks are not strict.");
  if (!sameChecks(checks)) {
    reasons.push("Main does not require only the two hj checks.");
  }
  if (methods.size !== 1 || !methods.has("rebase")) {
    reasons.push("The effective main merge method is not rebase only.");
  }
}

function validateReleaseBranch(
  rulesets: readonly GithubResource[],
  reasons: string[],
): void {
  for (const ruleset of rulesets) {
    const bypassed = actionsBypasses(ruleset, reasons);
    for (const rule of rules(ruleset, reasons)) {
      if (bypassed) continue;
      if (rule.type === "required_linear_history" && !("parameters" in rule)) {
        continue;
      }
      reasons.push(
        `Ruleset ${ruleset.name} blocks the release branch with rule ${rule.type}.`,
      );
    }
  }
}

function validateReleaseTag(
  rulesets: readonly GithubResource[],
  tag: string,
  reasons: string[],
): void {
  if (!parseSemver(tag)) reasons.push("The release tag is not SemVer.");
  let updateBlocked = false;
  let deletionBlocked = false;
  for (const ruleset of rulesets) {
    if (managedTagRulesets.has(ruleset.name)) {
      validateManagedTagBypass(ruleset, reasons);
    }
    const bypassed = actionsBypasses(ruleset, reasons);
    for (const rule of rules(ruleset, reasons)) {
      if (bypassed) continue;
      if (rule.type === "creation") {
        reasons.push(`Ruleset ${ruleset.name} blocks release-tag creation.`);
      } else if (rule.type === "update") {
        updateBlocked = true;
      } else if (rule.type === "deletion") {
        deletionBlocked = true;
      } else if (rule.type === "non_fast_forward") {
        if ("parameters" in rule) {
          reasons.push(
            `Ruleset ${ruleset.name} has invalid tag update parameters.`,
          );
        }
      } else if (rule.type === "tag_name_pattern") {
        validateTagPattern(rule, ruleset.name, tag, reasons);
      } else {
        reasons.push(
          `Ruleset ${ruleset.name} has unsupported tag rule ${rule.type}.`,
        );
      }
    }
  }
  if (!updateBlocked) reasons.push("The release tag can be updated.");
  if (!deletionBlocked) reasons.push("The release tag can be deleted.");
}

function validateLegacy(
  legacy: JsonObject | undefined,
  checks: Map<string, Set<number>>,
  reasons: string[],
): void {
  if (!legacy) return;
  const allowed = new Set([
    "url",
    "required_status_checks",
    "required_pull_request_reviews",
    "restrictions",
    "required_linear_history",
    "allow_force_pushes",
    "allow_deletions",
    "block_creations",
    "required_conversation_resolution",
    "lock_branch",
    "allow_fork_syncing",
    "enforce_admins",
    "required_signatures",
  ]);
  for (const key of Object.keys(legacy)) {
    if (!allowed.has(key)) {
      reasons.push(`Legacy protection has unsupported field ${key}.`);
    }
  }
  if (legacy.restrictions !== null && legacy.restrictions !== undefined) {
    reasons.push("Legacy branch restrictions can block the release.");
  }
  const reviews = optionalRecord(legacy.required_pull_request_reviews);
  if (reviews) validateLegacyReviews(reviews, reasons);
  const status = optionalRecord(legacy.required_status_checks);
  if (status) {
    if (typeof status.strict !== "boolean") {
      reasons.push("Legacy status strictness is unavailable.");
    }
    collectLegacyChecks(status, checks, reasons);
  }
  for (const field of ["allow_force_pushes", "allow_deletions"] as const) {
    const value = optionalEnabled(legacy[field]);
    if (value === undefined) {
      reasons.push(`Legacy ${field} data is unavailable.`);
    }
    if (value === true) reasons.push(`Legacy protection permits ${field}.`);
  }
  if (optionalEnabled(legacy.lock_branch) === true) {
    reasons.push("Legacy protection locks main.");
  }
  if (optionalEnabled(legacy.required_signatures) === true) {
    reasons.push("Legacy protection requires signed commits.");
  }
}

function collectLegacyChecks(
  status: Record<string, unknown>,
  checks: Map<string, Set<number>>,
  reasons: string[],
): void {
  const known = new Set(["url", "strict", "contexts", "checks"]);
  for (const key of Object.keys(status)) {
    if (!known.has(key)) {
      reasons.push(`Legacy status protection has unsupported field ${key}.`);
    }
  }
  const entries = Array.isArray(status.checks) ? status.checks : [];
  if (!Array.isArray(status.contexts)) {
    reasons.push("Legacy status contexts are unavailable.");
    return;
  }
  for (const context of status.contexts) {
    if (typeof context !== "string") {
      reasons.push("Legacy status context data is invalid.");
      continue;
    }
    const matches = entries.filter((entry) =>
      record(entry).context === context
    );
    if (
      matches.some((entry) =>
        Object.keys(record(entry)).some((key) =>
          key !== "context" && key !== "app_id"
        )
      )
    ) {
      reasons.push(`Legacy status context ${context} has unknown data.`);
      continue;
    }
    const appId = matches.length === 1 ? record(matches[0]).app_id : undefined;
    if (typeof appId !== "number") {
      reasons.push(`Legacy status context ${context} has no exact GitHub App.`);
    } else {
      addCheck(checks, context, appId);
    }
  }
}

function validateZeroReviews(
  parameters: Record<string, unknown>,
  source: string,
  reasons: string[],
): void {
  if (parameters.required_approving_review_count !== 0) {
    reasons.push(`${source} requires approvals.`);
  }
  for (
    const key of [
      "require_code_owner_review",
      "require_last_push_approval",
      "require_extra_approval_for_unattributed_changes",
    ]
  ) {
    if (parameters[key] !== false) reasons.push(`${source} requires ${key}.`);
  }
  if (
    !Array.isArray(parameters.required_reviewers) ||
    parameters.required_reviewers.length > 0
  ) reasons.push(`${source} requires named reviewers.`);
  for (
    const key of [
      "dismiss_stale_reviews_on_push",
      "required_review_thread_resolution",
    ]
  ) {
    if (typeof parameters[key] !== "boolean") {
      reasons.push(`${source} has unavailable ${key} data.`);
    }
  }
}

function validateLegacyReviews(
  reviews: Record<string, unknown>,
  reasons: string[],
): void {
  const known = new Set([
    "url",
    "dismissal_restrictions",
    "bypass_pull_request_allowances",
    "dismiss_stale_reviews",
    "require_code_owner_reviews",
    "require_last_push_approval",
    "required_approving_review_count",
  ]);
  for (const key of Object.keys(reviews)) {
    if (!known.has(key)) {
      reasons.push(`Legacy review protection has unsupported field ${key}.`);
    }
  }
  if (reviews.required_approving_review_count !== 0) {
    reasons.push("legacy protection requires approvals.");
  }
  for (
    const key of [
      "dismiss_stale_reviews",
      "require_code_owner_reviews",
      "require_last_push_approval",
    ]
  ) {
    if (typeof reviews[key] !== "boolean") {
      reasons.push(`Legacy review field ${key} is unavailable.`);
    } else if (key !== "dismiss_stale_reviews" && reviews[key] === true) {
      reasons.push(`Legacy protection requires ${key}.`);
    }
  }
}

function collectChecks(
  value: unknown,
  checks: Map<string, Set<number>>,
  source: string,
  reasons: string[],
): void {
  if (!Array.isArray(value)) {
    reasons.push(`Ruleset ${source} has no complete status-check list.`);
    return;
  }
  for (const item of value) {
    const check = record(item);
    if (
      Object.keys(check).some((key) =>
        key !== "context" && key !== "integration_id"
      ) || typeof check.context !== "string" ||
      typeof check.integration_id !== "number"
    ) {
      reasons.push(`Ruleset ${source} has invalid status-check data.`);
      continue;
    }
    addCheck(checks, check.context, check.integration_id);
  }
}

function validateTagPattern(
  rule: Record<string, unknown>,
  source: string,
  tag: string,
  reasons: string[],
): void {
  const parameters = parametersFor(
    rule,
    new Set(["name", "operator", "negate", "pattern"]),
    { name: source } as GithubResource,
    reasons,
  );
  if (!parameters) return;
  if (
    parameters.operator !== "regex" || typeof parameters.negate !== "boolean" ||
    typeof parameters.pattern !== "string" ||
    typeof parameters.name !== "string"
  ) {
    reasons.push(`Ruleset ${source} has incomplete tag-name parameters.`);
    return;
  }
  try {
    const matches = new RegExp(parameters.pattern).test(tag);
    if (parameters.negate ? matches : !matches) {
      reasons.push(`Ruleset ${source} rejects the release tag name.`);
    }
  } catch {
    reasons.push(`Ruleset ${source} has an unsupported tag-name pattern.`);
  }
}

function actionsBypasses(ruleset: GithubResource, reasons: string[]): boolean {
  const actors = ruleset.definition.bypass_actors;
  if (!Array.isArray(actors)) {
    reasons.push(`Ruleset ${ruleset.name} has no complete bypass data.`);
    return false;
  }
  return actors.some((value) => {
    const actor = record(value);
    return actor.actor_type === "Integration" &&
      actor.actor_id === actionsAppId && actor.bypass_mode === "always";
  });
}

function validateManagedTagBypass(
  ruleset: GithubResource,
  reasons: string[],
): void {
  const actors = ruleset.definition.bypass_actors;
  if (!Array.isArray(actors) || actors.length !== 1) {
    reasons.push(`Managed ruleset ${ruleset.name} has incorrect bypass data.`);
    return;
  }
  const actor = record(actors[0]);
  if (
    actor.actor_id !== 5 || actor.actor_type !== "RepositoryRole" ||
    actor.bypass_mode !== "always" || Object.keys(actor).length !== 3
  ) reasons.push(`Managed ruleset ${ruleset.name} has incorrect bypass data.`);
}

function sameChecks(checks: ReadonlyMap<string, ReadonlySet<number>>): boolean {
  return checks.size === requiredChecks.size &&
    [...requiredChecks].every(([context, app]) => {
      const actual = checks.get(context);
      return actual?.size === 1 && actual.has(app);
    });
}

function addCheck(
  checks: Map<string, Set<number>>,
  context: string,
  appId: number,
): void {
  const apps = checks.get(context) ?? new Set<number>();
  apps.add(appId);
  checks.set(context, apps);
}

const knownMergeMethods = new Set(["merge", "squash", "rebase"]);
const permittedMainRules = new Set([
  "deletion",
  "non_fast_forward",
  "required_linear_history",
]);
const pullRequestKeys = new Set([
  "allowed_merge_methods",
  "dismiss_stale_reviews_on_push",
  "require_code_owner_review",
  "require_extra_approval_for_unattributed_changes",
  "require_last_push_approval",
  "required_approving_review_count",
  "required_review_thread_resolution",
  "required_reviewers",
]);
const statusKeys = new Set([
  "do_not_enforce_on_create",
  "required_status_checks",
  "strict_required_status_checks_policy",
]);
