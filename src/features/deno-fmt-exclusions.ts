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

/** Keep existing exclusions and add required generated paths once. */
export function withFormatExclusions(
  config: JsonObject,
  required: readonly string[] = ["coverage"],
): JsonObject {
  const exclude = formatExclusions(config);
  return {
    ...config,
    fmt: {
      ...(isObject(config.fmt) ? config.fmt : {}),
      exclude: [
        ...exclude,
        ...required.filter((path) => !hasFormatExclusion(config, path)),
      ],
    },
  };
}

export function formatExclusionChanges(
  path: string,
  config: JsonObject,
  required: readonly string[] = ["coverage"],
): PlannedChange[] {
  const missing = required.filter((entry) =>
    !hasFormatExclusion(config, entry)
  );
  if (missing.length === 0) {
    return [];
  }
  if (isObject(config.fmt) && Array.isArray(config.fmt.exclude)) {
    const length = config.fmt.exclude.length;
    return missing.map((value, index) => ({
      kind: "set-json",
      path,
      jsonPath: ["fmt", "exclude", length + index],
      value,
      expected: undefined,
    }));
  }
  return [{
    kind: "set-json",
    path,
    jsonPath: ["fmt", "exclude"],
    value: missing,
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
  return hasFormatExclusion(config, "coverage");
}

export function hasFormatExclusion(
  config: JsonObject,
  required: string,
): boolean {
  const paths = [
    ...formatExclusions(config),
    ...(Array.isArray(config.exclude) ? config.exclude : []),
  ];
  return paths.some((path) => {
    if (typeof path !== "string") {
      return false;
    }
    const normalized = path.replace(/^\.\//, "");
    return normalized === required ||
      required === "coverage" && normalized === "coverage/";
  });
}
