/** @module Pinned CLI sources for generated workflows, including first publication. */

import type { ArtifactObservation } from "../api/artifact-inspection.ts";
import type {
  DetectionContext,
  OperationContext,
} from "../api/repository-context.ts";
import { hjPackageReference } from "./hj-package.ts";

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
  if (source === "jsr") return artifact;
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
