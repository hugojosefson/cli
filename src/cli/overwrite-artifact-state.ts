/** @module Comparison of overwrite snapshots without access metadata. */
import type { ArtifactObservation } from "../api/artifact-inspection.ts";
import { sameJson } from "../operations/local-plan-state.ts";

export function sameArtifact(
  left: ArtifactObservation,
  right: ArtifactObservation,
): boolean {
  if (left.kind !== right.kind) return false;
  const { access: _leftAccess, ...a } = "access" in left
    ? left
    : { ...left, access: undefined };
  const { access: _rightAccess, ...b } = "access" in right
    ? right
    : { ...right, access: undefined };
  return left.kind === "directory" && right.kind === "directory"
    ? left.stateDigest === right.stateDigest || right.stateDigest === "virtual"
    : sameJson(a, b);
}
