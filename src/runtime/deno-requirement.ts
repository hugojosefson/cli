/** @module Exact project pins and deliberately bounded stable Deno ranges. */
import { compareSemver, parseSemver } from "../release/semver.ts";
import { LocalFileReader } from "../repository/local-file-reader.ts";
import toolchain from "../../toolchain.json" with { type: "json" };
import type { DenoRuntimeOptions } from "./deno-options.ts";

export interface DenoRequirement {
  readonly text: string;
  readonly exact?: string;
  readonly minimum?: string;
  readonly maximum?: string;
  readonly preferred?: string;
}

export function exactDenoVersion(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = parseSemver(value);
  return !!parsed && parsed.build.length === 0 &&
    [parsed.major, parsed.minor, parsed.patch].every((part) =>
      Number.isSafeInteger(Number(part))
    );
}

export function denoRequirement(
  text: string,
  preferred?: string,
): DenoRequirement {
  if (exactDenoVersion(text)) {
    if (preferred !== undefined && preferred !== text) {
      throw new Error(
        "An exact Deno request cannot name a different preferred version.",
      );
    }
    return { text, exact: text, preferred: text };
  }
  let minimum: string | undefined;
  let maximum: string | undefined;
  const shortcut = /^(\^|~)(\d+\.\d+\.\d+)$/.exec(text);
  const wildcard = /^(\d+)\.(\d+)\.x$/.exec(text);
  const bounds = /^>=(\d+\.\d+\.\d+) +<(\d+(?:\.\d+\.\d+)?)$/.exec(text);
  if (shortcut) {
    minimum = shortcut[2];
    const [major, minor] = minimum.split(".").map(Number);
    maximum = shortcut[1] === "^"
      ? `${major + 1}.0.0`
      : `${major}.${minor + 1}.0`;
  } else if (wildcard) {
    minimum = `${wildcard[1]}.${wildcard[2]}.0`;
    maximum = `${wildcard[1]}.${Number(wildcard[2]) + 1}.0`;
  } else if (bounds) {
    minimum = bounds[1];
    maximum = bounds[2].includes(".") ? bounds[2] : `${bounds[2]}.0.0`;
  }
  if (
    !minimum || !maximum || !exactDenoVersion(minimum) ||
    !exactDenoVersion(maximum)
  ) {
    throw new Error(
      "Use an exact Deno version, ^2.9.6, ~2.9.6, 2.10.x, or a stable range such as >=2.9.6 <3. Prereleases require an exact pin.",
    );
  }
  const lower = parseSemver(minimum)!;
  const upper = parseSemver(maximum)!;
  if (
    lower.major === "0" || compareSemver(lower, upper) >= 0 ||
    !(lower.major === upper.major ||
      Number(upper.major) === Number(lower.major) + 1 && upper.minor === "0" &&
        upper.patch === "0")
  ) {
    throw new Error(
      "A Deno range must stay within one major version and have increasing bounds.",
    );
  }
  const result = { text, minimum, maximum, preferred };
  if (
    preferred !== undefined &&
    (!exactDenoVersion(preferred) || !acceptsDeno(result, preferred))
  ) {
    throw new Error(
      "The preferred Deno version must be an exact stable version inside its accepted range.",
    );
  }
  return result;
}

export function acceptsDeno(
  requirement: DenoRequirement,
  version: string,
): boolean {
  if (!exactDenoVersion(version)) return false;
  if (requirement.exact) return version === requirement.exact;
  const parsed = parseSemver(version)!;
  return parsed.prerelease.length === 0 &&
    compareSemver(parsed, parseSemver(requirement.minimum!)!) >= 0 &&
    compareSemver(parsed, parseSemver(requirement.maximum!)!) < 0;
}

/** Requirements belong to the supplied project directory, without ancestor lookup. */
export async function projectDenoRequirement(
  root: URL,
  options: DenoRuntimeOptions,
): Promise<DenoRequirement> {
  if (options.requirement !== undefined) {
    return denoRequirement(options.requirement, options.preferred);
  }
  const files = new LocalFileReader(root);
  const read = async (path: string) => {
    const value = await files.observe(path);
    if (value.kind === "absent") return undefined;
    if (value.kind !== "file") {
      throw new Error(`${path} must be a readable regular file.`);
    }
    return value.content;
  };
  const pin = await read(".deno-version");
  const config = await read(".hj/deno-runtime.json");
  if (pin !== undefined && config !== undefined) {
    throw new Error(
      "Choose either .deno-version or .hj/deno-runtime.json, not both.",
    );
  }
  if (pin !== undefined) {
    if (!exactDenoVersion(pin.trim())) {
      throw new Error(
        ".deno-version must contain one exact Deno version. Put ranges in .hj/deno-runtime.json.",
      );
    }
    return denoRequirement(pin.trim());
  }
  if (config !== undefined) {
    let value: unknown;
    try {
      value = JSON.parse(config);
    } catch {
      throw new Error(".hj/deno-runtime.json must contain valid JSON.");
    }
    if (
      !value || typeof value !== "object" || Array.isArray(value) ||
      !("range" in value) || typeof value.range !== "string" ||
      Object.keys(value).some((key) => !["range", "preferred"].includes(key)) ||
      ("preferred" in value && typeof value.preferred !== "string")
    ) {
      throw new Error(
        ".hj/deno-runtime.json accepts a range string and an optional preferred version string.",
      );
    }
    if (exactDenoVersion(value.range)) {
      throw new Error("Use .deno-version for an exact project version.");
    }
    return denoRequirement(
      value.range,
      "preferred" in value ? value.preferred as string : undefined,
    );
  }
  return denoRequirement(
    `>=${toolchain.deno} <${Number(toolchain.deno.split(".")[0]) + 1}`,
    toolchain.deno,
  );
}
