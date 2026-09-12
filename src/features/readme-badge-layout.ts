/** @module Shared read-only badge layout detection for README providers. */
import type { FeatureDetection } from "../api/feature-detection.ts";
import { badgeLayoutResolution, layoutBadges } from "../readme/badge-layout.ts";

export function badgeLayoutDetection(
  text: string,
  path: string,
): FeatureDetection | undefined {
  if (layoutBadges(text) === text) return undefined;
  return {
    state: "drifted",
    evidence: [],
    issues: [{
      code: "readme-badge-layout",
      kind: "readme",
      subject: { kind: "repository-path", identifier: path },
      observation:
        `${path} badges are not one ordered row after the first paragraph.`,
      resolution: badgeLayoutResolution(text, path),
    }],
  };
}
