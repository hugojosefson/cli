/** @module Strict SemVer parsing and precedence comparison for release tags. */

export type Semver = {
  readonly major: string;
  readonly minor: string;
  readonly patch: string;
  readonly prerelease: readonly string[];
  readonly build: readonly string[];
};

const semver =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function parseSemver(value: string): Semver | undefined {
  const match = semver.exec(value);
  if (!match) {
    return undefined;
  }
  return {
    major: match[1],
    minor: match[2],
    patch: match[3],
    prerelease: match[4]?.split(".") ?? [],
    build: match[5]?.split(".") ?? [],
  };
}

/** Compares SemVer precedence; build metadata does not participate. */
export function compareSemver(left: Semver, right: Semver): number {
  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] !== right[key]) {
      return compareNumericIdentifier(left[key], right[key]);
    }
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return left.prerelease.length === right.prerelease.length
      ? 0
      : left.prerelease.length === 0
      ? 1
      : -1;
  }
  for (
    let index = 0;
    index < Math.max(left.prerelease.length, right.prerelease.length);
    index++
  ) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined || rightPart === undefined) {
      return leftPart === rightPart ? 0 : leftPart === undefined ? -1 : 1;
    }
    if (leftPart === rightPart) {
      continue;
    }
    const leftNumber = /^\d+$/.test(leftPart);
    const rightNumber = /^\d+$/.test(rightPart);
    if (leftNumber !== rightNumber) {
      return leftNumber ? -1 : 1;
    }
    if (leftNumber && rightNumber) {
      return compareNumericIdentifier(leftPart, rightPart);
    }
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

function compareNumericIdentifier(left: string, right: string): number {
  return left.length === right.length
    ? left < right ? -1 : left > right ? 1 : 0
    : left.length < right.length
    ? -1
    : 1;
}
