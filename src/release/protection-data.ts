/** Defensive readers for GitHub protection responses. */
import type { GithubResource } from "../api/repository-context.ts";
export function optionalEnabled(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  const object = optionalRecord(value);
  return typeof object?.enabled === "boolean" ? object.enabled : undefined;
}

export function stringArray(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value as string[]
    : undefined;
}

export function optionalRecord(
  value: unknown,
): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function record(value: unknown): Record<string, unknown> {
  return optionalRecord(value) ?? {};
}

export function rules(
  ruleset: GithubResource,
  reasons: string[],
): readonly Record<string, unknown>[] {
  const value = ruleset.definition.rules;
  if (!Array.isArray(value)) {
    reasons.push(`Ruleset ${ruleset.name} has no complete rule list.`);
    return [];
  }
  return value.flatMap((item) => {
    const rule = record(item);
    if (
      typeof rule.type !== "string" ||
      Object.keys(rule).some((key) => key !== "type" && key !== "parameters")
    ) {
      reasons.push(`Ruleset ${ruleset.name} has invalid rule data.`);
      return [];
    }
    return [rule];
  });
}

export function parametersFor(
  rule: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  ruleset: GithubResource,
  reasons: string[],
): Record<string, unknown> | undefined {
  const parameters = optionalRecord(rule.parameters);
  if (
    !parameters || Object.keys(parameters).some((key) => !allowed.has(key))
  ) {
    reasons.push(
      `Ruleset ${ruleset.name} has unsupported ${rule.type} parameters.`,
    );
    return undefined;
  }
  return parameters;
}
