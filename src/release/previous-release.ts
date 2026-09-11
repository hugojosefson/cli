/** @module Selects an applicable previous release or a first-release baseline. */

import { compareSemver, parseSemver } from "./semver.ts";

export type ReleaseTag = {
  readonly name: string;
  readonly target: string;
  readonly lightweight: boolean;
  readonly targetIsAncestor: boolean;
};

export type PreviousRelease =
  | { readonly kind: "tag"; readonly tag: ReleaseTag }
  | {
    readonly kind: "baseline";
    readonly version: string;
    readonly tag: null;
    readonly target: null;
  }
  | {
    readonly kind: "version-mismatch";
    readonly configuredVersion: string;
    readonly tag: ReleaseTag;
  }
  | { readonly kind: "conflict"; readonly tags: readonly ReleaseTag[] };

/**
 * Selects the greatest lightweight SemVer tag that reaches selected main. When
 * none applies, the configured version is the first-release baseline.
 */
export function selectPreviousRelease(
  tags: readonly ReleaseTag[],
  configuredVersion: string,
): PreviousRelease {
  if (!parseSemver(configuredVersion)) {
    throw new TypeError(
      `Configured version is not SemVer: ${configuredVersion}`,
    );
  }
  const applicable = tags.flatMap((tag) => {
    const version = tag.lightweight && tag.targetIsAncestor
      ? parseSemver(tag.name)
      : undefined;
    return version ? [{ tag, version }] : [];
  });
  if (applicable.length === 0) {
    return {
      kind: "baseline",
      version: configuredVersion,
      tag: null,
      target: null,
    };
  }
  const greatest = applicable.reduce((best, item) =>
    compareSemver(item.version, best.version) > 0 ? item : best
  );
  const conflicts = applicable.filter((item) =>
    compareSemver(item.version, greatest.version) === 0
  ).map((item) => item.tag);
  if (conflicts.length > 1) {
    return { kind: "conflict", tags: conflicts };
  }
  if (greatest.tag.name !== configuredVersion) {
    return {
      kind: "version-mismatch",
      configuredVersion,
      tag: greatest.tag,
    };
  }
  return { kind: "tag", tag: greatest.tag };
}
