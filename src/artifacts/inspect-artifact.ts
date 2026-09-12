/** @module Pure exact artifact inspection. */

import { matchesFileAccess } from "../repository/file-access.ts";
import type {
  ArtifactObservation,
  ArtifactSchema,
  ExactArtifactDifference,
  ExactArtifactInspection,
} from "../api/artifact-inspection.ts";

/** Compares an observation with one exact artifact schema. */
export function inspectArtifact(
  schema: ArtifactSchema,
  observation: ArtifactObservation,
): ExactArtifactInspection {
  if (observation.kind === "unreadable") {
    return {
      result: "unreadable",
      schema,
      observation: observation.observation,
    };
  }
  if (schema.kind === "absent") {
    if (observation.kind === "absent") {
      return { result: "matches", schema, observation };
    }
    return kindDifference(schema, observation);
  }
  if (observation.kind === "absent") {
    return { result: "absent", schema };
  }
  if (schema.kind !== observation.kind) {
    return kindDifference(schema, observation);
  }
  const differences = differencesFor(schema, observation);
  if (differences.length === 0) {
    return { result: "matches", schema, observation };
  }
  return { result: "differs", schema, observation, differences };
}

function kindDifference(
  schema: ArtifactSchema,
  observation: Exclude<
    ArtifactObservation,
    { readonly kind: "unreadable" | "absent" }
  >,
): ExactArtifactInspection {
  return {
    result: "differs",
    schema,
    observation,
    differences: [{
      kind: "artifact-kind",
      expected: schema.kind,
      actual: observation.kind,
    }],
  };
}

function differencesFor(
  schema: Exclude<ArtifactSchema, { readonly kind: "absent" }>,
  observation: Exclude<
    ArtifactObservation,
    { readonly kind: "absent" | "unreadable" }
  >,
): readonly ExactArtifactDifference[] {
  if (schema.kind === "file" && observation.kind === "file") {
    return [
      ...(schema.content === observation.content ? [] : [{
        kind: "content" as const,
        expected: schema.content,
        actual: observation.content,
      }]),
      ...(matchesFileAccess(observation, schema.mode) ? [] : [{
        kind: "mode" as const,
        expected: schema.mode,
        actual: observation.mode,
      }]),
    ];
  }
  if (schema.kind === "directory" && observation.kind === "directory") {
    return schema.stateDigest === observation.stateDigest ? [] : [{
      kind: "directory-state",
      expected: schema.stateDigest,
      actual: observation.stateDigest,
    }];
  }
  if (schema.kind === "symlink" && observation.kind === "symlink") {
    return schema.target === observation.target ? [] : [{
      kind: "symlink-target",
      expected: schema.target,
      actual: observation.target,
    }];
  }
  return [];
}
