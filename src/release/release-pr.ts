/** @module Deterministic generated release pull-request ownership data. */

import { releaseBundleSchema } from "./release-bundle.ts";
import { parseSemver } from "./semver.ts";

export type ReleaseOwnership = {
  readonly schema: typeof releaseBundleSchema;
  readonly selectedSha: string;
  readonly version: string;
  readonly branchHead: string;
  readonly treeDigest: string;
};

/** Returns the exact machine-readable ownership marker used in generated bodies. */
export function releaseOwnershipMarker(ownership: ReleaseOwnership): string {
  validateOwnership(ownership);
  return `<!-- hj-release-ownership ${JSON.stringify(ownership)} -->`;
}

/** Builds a stable generated body without timestamps or repository-dependent prose. */
export function releasePullRequestBody(ownership: ReleaseOwnership): string {
  return `## Release ${ownership.version}\n\nGenerated release for \`${ownership.version}\` from \`${ownership.selectedSha}\`.\n\n${
    releaseOwnershipMarker(ownership)
  }\n`;
}

/** Parses only one exact ownership marker. */
export function parseReleaseOwnershipMarker(
  body: string,
): ReleaseOwnership | undefined {
  const matches = body.match(/<!-- hj-release-ownership (\{[^\n]*\}) -->/g);
  if (!matches || matches.length !== 1) return undefined;
  try {
    const text = matches[0].slice(
      "<!-- hj-release-ownership ".length,
      -" -->".length,
    );
    const value: unknown = JSON.parse(text);
    validateOwnership(value);
    return value;
  } catch {
    return undefined;
  }
}

function validateOwnership(value: unknown): asserts value is ReleaseOwnership {
  if (
    typeof value !== "object" || value === null || Array.isArray(value) ||
    Object.keys(value).join(",") !==
      "schema,selectedSha,version,branchHead,treeDigest"
  ) throw new TypeError("Release ownership fields are invalid.");
  const item = value as ReleaseOwnership;
  if (
    item.schema !== releaseBundleSchema ||
    !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(item.selectedSha) ||
    !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(item.branchHead) ||
    !/^[0-9a-f]{64}$/.test(item.treeDigest) || !parseSemver(item.version)
  ) throw new TypeError("Release ownership data is invalid.");
}
