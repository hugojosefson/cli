/** Validate GitHub response shapes before repository operations use them. */
import type { JsonObject } from "../api/json.ts";
import type { GithubRepository } from "../api/repository-context.ts";
import { canonical } from "./canonical-ruleset.ts";
import { digestBytes } from "./digest-bytes.ts";

export function repositoryFromResponse(
  value: unknown,
): GithubRepository | undefined {
  const response = object(value);
  if (typeof response?.nameWithOwner !== "string") return undefined;
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(
    response.nameWithOwner,
  );
  if (!match) return undefined;
  const branch = response.defaultBranchRef;
  if (
    branch !== null && branch !== undefined &&
    typeof object(branch)?.name !== "string"
  ) return undefined;
  return {
    owner: match[1],
    name: match[2],
    defaultBranch: object(branch)?.name as string | undefined,
  };
}
export function json(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}

export function rulesetId(value: unknown): number | undefined {
  const id = value !== null && typeof value === "object"
    ? (value as { id?: unknown }).id
    : undefined;
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0
    ? id
    : undefined;
}
export function rulesetDefinition(value: unknown): JsonObject | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const object = value as Record<string, unknown>;
  if (
    typeof object.name !== "string" || typeof object.target !== "string" ||
    typeof object.enforcement !== "string" || !Array.isArray(object.rules) ||
    !Array.isArray(object.bypass_actors) || object.conditions === null ||
    typeof object.conditions !== "object"
  ) return undefined;
  return canonical({
    name: object.name,
    target: object.target,
    enforcement: object.enforcement,
    bypass_actors: object.bypass_actors,
    conditions: object.conditions,
    rules: object.rules,
  }) as JsonObject;
}
export function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}
export function withoutId(value: JsonObject): JsonObject {
  const { id: _id, ...definition } = value;
  return definition;
}
export async function rulesetDigest(definition: JsonObject): Promise<string> {
  return await digestBytes(
    new TextEncoder().encode(JSON.stringify(definition)),
  );
}

export function safeRepositoryPath(path: string): boolean {
  return path.length > 0 && !path.startsWith("/") && !path.includes("\\") &&
    !path.split("/").some((part) => !part || part === "." || part === "..") &&
    !path.includes("\0") && !path.includes("\n") && !path.includes("\r");
}
