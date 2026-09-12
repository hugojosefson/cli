/** @module Pinned CLI sources for generated workflows, including first publication. */

import type { ArtifactObservation } from "../api/artifact-inspection.ts";
import type {
  DetectionContext,
  OperationContext,
} from "../api/repository-context.ts";
import { workflowDenoArtifact } from "./workflow-deno.ts";
import { hjPackageReference } from "./hj-package.ts";
import { parseSemver } from "../release/semver.ts";

const marker = "# hj-workflow-cli: ";

/** Accepts the normal registry source or a GitHub repository at an exact commit. */
export function validateWorkflowCli(source: string): string {
  if (
    source === "jsr" ||
    /^github:[A-Za-z0-9_-]+\/[A-Za-z0-9_-][A-Za-z0-9_.-]*@[0-9a-f]{40}$/.test(
      source,
    )
  ) {
    return source;
  }
  throw new TypeError(
    "--workflow-cli must be jsr or github:owner/repository@<40-character commit SHA>.",
  );
}

/** Builds an exact owned variant. Unrelated workflows have no CLI source to replace. */
export function workflowCliArtifact<
  T extends { readonly path: string; readonly content: string },
>(
  artifact: T,
  context: DetectionContext,
  observation: ArtifactObservation,
): { readonly path: string; readonly content: string } {
  artifact = workflowDenoArtifact(artifact, context, observation);
  if (!artifact.content.includes(hjPackageReference)) return artifact;
  const selected = (context as Partial<OperationContext>).options?.workflowCli;
  const recorded = observation.kind === "file"
    ? observation.content.split("\n")[1]
    : undefined;
  const source = selected ??
    (recorded?.startsWith(marker) ? recorded.slice(marker.length) : "jsr");
  if (typeof source !== "string") {
    throw new TypeError("Invalid workflow CLI source.");
  }
  try {
    validateWorkflowCli(source);
  } catch (error) {
    if (selected !== undefined) throw error;
    return artifact;
  }
  if (source === "jsr") {
    const reference = selected === undefined
      ? recordedRegistryReference(observation)
      : undefined;
    return reference
      ? {
        ...artifact,
        content: artifact.content.replaceAll(hjPackageReference, reference),
      }
      : artifact;
  }
  const [repository, revision] = source.slice("github:".length).split("@");
  const base = `https://raw.githubusercontent.com/${repository}/${revision}`;
  const command = `--import-map=${base}/deno.json ${base}/src/cli/cli.ts`;
  const newline = artifact.content.indexOf("\n") + 1;
  return {
    path: artifact.path,
    content: (artifact.content.slice(0, newline) + marker + source + "\n" +
      artifact.content.slice(newline))
      .replaceAll(hjPackageReference, command),
  };
}

/** A different exact CLI pin is configuration, not a change to the workflow. */
function recordedRegistryReference(
  observation: ArtifactObservation,
): string | undefined {
  if (observation.kind !== "file") return undefined;
  const prefix = hjPackageReference.slice(
    0,
    hjPackageReference.lastIndexOf("@") + 1,
  );
  const references = new Set(
    observation.content.split(/\s+/).filter((word) => word.startsWith(prefix)),
  );
  if (references.size !== 1) return undefined;
  const reference = [...references][0];
  return parseSemver(reference.slice(prefix.length)) ? reference : undefined;
}
