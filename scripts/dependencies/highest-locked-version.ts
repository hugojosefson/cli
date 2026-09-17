import { compareSemver, parseSemver } from "../../src/release/semver.ts";

/** Select the highest locked SemVer. Reject equal precedence with different metadata. */
export function highestLockedVersion(versions: string[]): string {
  const sorted = [...new Set(versions)].map((version) => {
    const parsed = parseSemver(version);
    if (!parsed) {
      throw new Error(`Invalid locked SemVer: ${version}.`);
    }
    return { version, parsed };
  }).sort((a, b) => compareSemver(b.parsed, a.parsed));
  if (!sorted.length) {
    throw new Error("No locked versions.");
  }
  if (sorted[1] && compareSemver(sorted[0].parsed, sorted[1].parsed) === 0) {
    throw new Error("Locked versions have ambiguous SemVer precedence.");
  }
  return sorted[0].version;
}
