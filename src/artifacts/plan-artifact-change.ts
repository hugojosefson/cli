/** @module Safe pure artifact planning. */

import type { ExactArtifactInspection } from "../api/artifact-inspection.ts";
import type { PlannedChange } from "../api/planned-change.ts";

/** A plan outcome that never overwrites an unrecognized artifact. */
export type ArtifactPlan =
  | { readonly result: "no-op"; readonly changes: readonly [] }
  | { readonly result: "planned"; readonly changes: readonly PlannedChange[] }
  | {
    readonly result: "drifted";
    readonly inspection: Extract<
      ExactArtifactInspection,
      { readonly result: "differs" }
    >;
  }
  | {
    readonly result: "ambiguous";
    readonly inspection: ExactArtifactInspection;
  }
  | { readonly result: "preserved"; readonly changes: readonly [] };

/** Plans creation only when the expected artifact path is absent. */
export function planArtifactCreation(
  inspection: ExactArtifactInspection,
): ArtifactPlan {
  if (inspection.result === "matches") {
    return { result: "no-op", changes: [] };
  }
  if (inspection.result === "differs") {
    return inspection.observation.kind === inspection.schema.kind
      ? { result: "drifted", inspection }
      : { result: "ambiguous", inspection };
  }
  if (inspection.result === "unreadable") {
    return { result: "ambiguous", inspection };
  }
  if (inspection.schema.kind === "file") {
    return {
      result: "planned",
      changes: [{
        kind: "write-file",
        path: inspection.schema.path,
        content: inspection.schema.content,
        mode: inspection.schema.mode,
        expectedDigest: undefined,
      }],
    };
  }
  if (inspection.schema.kind === "directory") {
    return {
      result: "planned",
      changes: [{ kind: "create-directory", path: inspection.schema.path }],
    };
  }
  return {
    result: "planned",
    changes: [{
      kind: "create-symlink",
      path: inspection.schema.path,
      target: inspection.schema.target,
    }],
  };
}

/** Plans removal only for an unchanged artifact declared as feature-owned. */
export function planArtifactRemoval(
  inspection: ExactArtifactInspection,
  ownership: "owned" | "seed",
): ArtifactPlan {
  if (inspection.result === "absent") {
    return { result: "no-op", changes: [] };
  }
  if (inspection.result === "matches" && inspection.schema.kind === "absent") {
    return { result: "no-op", changes: [] };
  }
  if (ownership === "seed") {
    return { result: "preserved", changes: [] };
  }
  if (inspection.result === "matches" && inspection.schema.kind === "file") {
    if (inspection.observation.kind !== "file") {
      return { result: "ambiguous", inspection };
    }
    return {
      result: "planned",
      changes: [{
        kind: "remove-file",
        path: inspection.schema.path,
        expectedDigest: inspection.observation.digest,
      }],
    };
  }
  if (
    inspection.result === "matches" && inspection.schema.kind === "directory"
  ) {
    return {
      result: "planned",
      changes: [{
        kind: "remove-directory",
        path: inspection.schema.path,
        expectedStateDigest: inspection.schema.stateDigest,
      }],
    };
  }
  if (inspection.result === "matches" && inspection.schema.kind === "symlink") {
    return {
      result: "planned",
      changes: [{
        kind: "remove-symlink",
        path: inspection.schema.path,
        expectedTarget: inspection.schema.target,
      }],
    };
  }
  if (
    inspection.result === "differs" &&
    inspection.observation.kind === inspection.schema.kind
  ) {
    return { result: "drifted", inspection };
  }
  return { result: "ambiguous", inspection };
}
