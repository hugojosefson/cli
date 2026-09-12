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

/** Match retained workflow steps before describing insertions or edits. */
function describeWorkflowSteps(
  value: JsonValue[],
  before: JsonValue[],
  path: string,
): string[] {
  const used = new Set<number>();
  const previous = value.map((item) => {
    const index = before.findIndex((old, index) =>
      !used.has(index) && JSON.stringify(old) === JSON.stringify(item)
    );
    if (index >= 0) used.add(index);
    return index;
  });
  const identity = (item: JsonValue): string | undefined => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return;
    for (const key of ["id", "name", "uses"]) {
      const field = (item as JsonObject)[key];
      if (typeof field === "string") {
        const value = key === "uses" ? field.split("@")[0] : field;
        return JSON.stringify([key, value]);
      }
    }
  };
  // Named steps and action upgrades retain their identity when fields change.
  value.forEach((item, index) => {
    if (previous[index] >= 0) return;
    const key = identity(item);
    if (key === undefined) return;
    const match = before.findIndex((old, oldIndex) =>
      !used.has(oldIndex) && identity(old) === key
    );
    if (match >= 0) {
      previous[index] = match;
      used.add(match);
    }
  });
  const remaining = before.map((_item, index) => index).filter((index) =>
    !used.has(index)
  );
  const unmatched = previous.filter((index) => index < 0).length;
  // Equal remaining counts can represent edited anonymous commands. Others stay
  // explicit additions/removals instead of attributing an insertion to a step.
  if (remaining.length === unmatched) {
    previous.forEach((old, index) => {
      if (old < 0) {
        previous[index] = remaining.shift()!;
        used.add(previous[index]);
      }
    });
  }
  const order = previous.filter((index) => index >= 0);
  const sorted = [...order].sort((a, b) => a - b);
  let first = 0;
  let last = order.length;
  while (first < last && order[first] === sorted[first]) first++;
  while (last > first && order[last - 1] === sorted[last - 1]) last--;
  return [
    ...value.flatMap((item, index) =>
      describeConfiguration(item, before[previous[index]], `${path}[${index}]`)
    ),
    ...before.flatMap((_item, index) =>
      used.has(index) ? [] : [`remove ${path}[${index}]`]
    ),
    ...(first < last
      ? [
        `reorder retained ${path}: original indices ${
          order.slice(first, last).join(", ")
        } must appear in that order`,
      ]
      : []),
  ];
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
    Array.isArray(value) && Array.isArray(expected) &&
    /^jobs\..+\.steps$/.test(path)
  ) return describeWorkflowSteps(value, expected, path);
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
