/** Select rulesets that apply to a branch or tag; unknown patterns block release. */
import type { GithubResource } from "../api/repository-context.ts";
import { optionalRecord, record, stringArray } from "./protection-data.ts";
export function applicableRulesets(
  rulesets: readonly GithubResource[],
  target: "branch" | "tag",
  ref: string,
  defaultBranch: string,
  reasons: string[],
): readonly GithubResource[] {
  return rulesets.filter((ruleset) => {
    if (!ruleset.source || !ruleset.sourceType) {
      reasons.push(`Ruleset ${ruleset.name} has no complete source data.`);
      return false;
    }
    const definition = record(ruleset.definition);
    const enforcement = definition.enforcement;
    if (enforcement === "disabled" || enforcement === "evaluate") return false;
    if (enforcement !== "active") {
      reasons.push(`Ruleset ${ruleset.name} has unknown enforcement.`);
      return false;
    }
    if (definition.target !== "branch" && definition.target !== "tag") {
      reasons.push(`Ruleset ${ruleset.name} has an unknown target.`);
      return false;
    }
    if (definition.target !== target) return false;
    const applies = refConditionApplies(
      definition.conditions,
      ref,
      defaultBranch,
    );
    if (applies === undefined) {
      reasons.push(`Ruleset ${ruleset.name} has an unsupported ref condition.`);
      return false;
    }
    return applies;
  });
}

function refConditionApplies(
  value: unknown,
  ref: string,
  defaultBranch: string,
): boolean | undefined {
  const conditions = optionalRecord(value);
  if (
    !conditions || Object.keys(conditions).some((key) => key !== "ref_name")
  ) {
    return undefined;
  }
  const refName = optionalRecord(conditions.ref_name);
  if (
    !refName ||
    Object.keys(refName).some((key) => key !== "include" && key !== "exclude")
  ) return undefined;
  const include = stringArray(refName.include);
  const exclude = stringArray(refName.exclude);
  if (!include || !exclude || include.length === 0) return undefined;
  const included = matchesAny(include, ref, defaultBranch);
  const excluded = matchesAny(exclude, ref, defaultBranch);
  return included === undefined || excluded === undefined
    ? undefined
    : included && !excluded;
}

function matchesAny(
  patterns: readonly string[],
  ref: string,
  defaultBranch: string,
): boolean | undefined {
  let matched = false;
  for (const pattern of patterns) {
    const result = matchRef(pattern, ref, defaultBranch);
    if (result === undefined) return undefined;
    matched ||= result;
  }
  return matched;
}

function matchRef(
  pattern: string,
  ref: string,
  defaultBranch: string,
): boolean | undefined {
  if (pattern === "~ALL") return true;
  if (pattern === "~DEFAULT_BRANCH") {
    return ref === `refs/heads/${defaultBranch}`;
  }
  if (!pattern.startsWith("refs/heads/") && !pattern.startsWith("refs/tags/")) {
    return undefined;
  }
  const source = globPattern(pattern);
  return source === undefined ? undefined : new RegExp(`^${source}$`).test(ref);
}

function globPattern(pattern: string): string | undefined {
  let result = "";
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index];
    if (character === "*") {
      result += ".*";
    } else if (character === "?") {
      result += ".";
    } else if (character === "[") {
      const end = pattern.indexOf("]", index + 1);
      if (end < 0 || !/^[0-9A-Za-z-]+$/.test(pattern.slice(index + 1, end))) {
        return undefined;
      }
      result += pattern.slice(index, end + 1);
      index = end;
    } else if (/^[0-9A-Za-z/_.+-]$/.test(character)) {
      result += character === "." || character === "+"
        ? `\\${character}`
        : character;
    } else {
      return undefined;
    }
  }
  return result;
}
