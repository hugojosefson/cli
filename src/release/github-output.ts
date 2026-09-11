/** @module GitHub Actions output-size validation. */

export const githubOutputLimit = 1_000_000;

/** Counts UTF-16 code units, the unit GitHub uses for workflow outputs. */
export function githubOutputSize(values: readonly string[]): number {
  return values.reduce((size, value) => size + value.length, 0);
}

/** Rejects only output totals larger than GitHub's exact 1 MB limit. */
export function validateGithubOutputSize(values: readonly string[]): void {
  if (githubOutputSize(values) > githubOutputLimit) {
    throw new RangeError("GitHub output values exceed 1 MB.");
  }
}
