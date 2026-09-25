/** @module Formatting exclusions in Deno configuration. */
import type { JsonObject, JsonValue } from "../api/json.ts";
import type { PlannedChange } from "../api/planned-change.ts";
import { sameJson } from "../operations/local-plan-state.ts";
import { denoTaskDefinitions, isObject } from "./deno-tasks.ts";

export function formatExclusionError(config: JsonObject): string | undefined {
  if (config.fmt === undefined) {
    return undefined;
  }
  if (!isObject(config.fmt)) {
    return "fmt must be an object.";
  }
  const exclude = config.fmt.exclude;
  if (
    exclude !== undefined &&
    (!Array.isArray(exclude) ||
      exclude.some((item) => typeof item !== "string"))
  ) {
    return "fmt.exclude must be an array of paths.";
  }
  return undefined;
}

export function formatExclusions(config: JsonObject): readonly JsonValue[] {
  return isObject(config.fmt) && Array.isArray(config.fmt.exclude)
    ? config.fmt.exclude
    : [];
}

/** Keep existing exclusions and add the generated coverage directory once. */
export function withFormatExclusions(config: JsonObject): JsonObject {
  const exclude = formatExclusions(config);
  return {
    ...config,
    fmt: {
      ...(isObject(config.fmt) ? config.fmt : {}),
      exclude: hasCoverageExclusion(config)
        ? exclude
        : [...exclude, "coverage"],
    },
  };
}

export function formatExclusionChanges(
  path: string,
  config: JsonObject,
): PlannedChange[] {
  if (hasCoverageExclusion(config)) {
    return [];
  }
  return [{
    kind: "set-json",
    path,
    jsonPath: isObject(config.fmt) && Array.isArray(config.fmt.exclude)
      ? ["fmt", "exclude", config.fmt.exclude.length]
      : ["fmt", "exclude"],
    value: isObject(config.fmt) && Array.isArray(config.fmt.exclude)
      ? "coverage"
      : ["coverage"],
    expected: undefined,
  }];
}

/** Generated commands use the coverage exclusion from configuration. */
export function missingFormatExclusion(config: JsonObject): boolean {
  if (
    !isObject(config.tasks) || hasCoverageExclusion(config)
  ) {
    return false;
  }
  const definitions = denoTaskDefinitions();
  const tasks = config.tasks;
  return ["fmt", "format"].some((name) =>
    sameJson(tasks[name], definitions[name])
  );
}

/** Deno accepts these directory spellings for the same coverage path. */
export function hasCoverageExclusion(config: JsonObject): boolean {
  const paths = [
    ...formatExclusions(config),
    ...(Array.isArray(config.exclude) ? config.exclude : []),
  ];
  return paths.some((path) =>
    typeof path === "string" && /^(?:\.\/)?coverage\/?$/.test(path)
  );
}
