/** @module Changed configuration fields with credential values excluded. */
import type { JsonObject, JsonValue } from "../api/json.ts";

const sensitiveKey =
  /(?:secret|token|password|passwd|credential|authorization|api.?key|private.?key)/i;

/** Scrubs recognizable credentials in otherwise useful generated configuration. */
export function safeRepairText(value: string): string {
  return value
    .replace(/(https?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, "$1[redacted]@")
    .replace(
      /\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/g,
      "[redacted]",
    )
    .replace(
      /(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi,
      "$1[redacted]",
    )
    .replace(
      /((?:["']?)(?:token|password|passwd|secret|authorization|api[_-]?key)(?:["']?)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      "$1[redacted]",
    );
}

function safeValue(value: JsonValue): JsonValue {
  if (typeof value === "string") return safeRepairText(value);
  if (Array.isArray(value)) return value.map(safeValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map((
        [key, item],
      ) => [key, sensitiveKey.test(key) ? "[redacted]" : safeValue(item)]),
    );
  }
  return value;
}

/** Omits unchanged fields so preserved custom commands and values stay private. */
export function describeConfiguration(
  value: JsonValue,
  expected?: JsonValue,
  path = "",
): string[] {
  if (JSON.stringify(value) === JSON.stringify(expected)) return [];
  if (sensitiveKey.test(path)) return [`${path} = [redacted]`];
  if (
    Array.isArray(value) &&
    value.some((item) => item !== null && typeof item === "object")
  ) {
    const before = Array.isArray(expected) ? expected : [];
    return [
      ...value.flatMap((item, index) =>
        describeConfiguration(item, before[index], `${path}[${index}]`)
      ),
      ...before.slice(value.length).map((_item, index) =>
        `remove ${path}[${value.length + index}]`
      ),
    ];
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const before =
      expected && typeof expected === "object" && !Array.isArray(expected)
        ? expected as JsonObject
        : {};
    return [
      ...Object.entries(value).flatMap(([key, item]) =>
        describeConfiguration(item, before[key], path ? `${path}.${key}` : key)
      ),
      ...Object.keys(before).filter((key) => !Object.hasOwn(value, key)).map((
        key,
      ) => `remove ${path ? `${path}.` : ""}${key}`),
    ];
  }
  return [`${path} = ${JSON.stringify(safeValue(value))}`];
}
