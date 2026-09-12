/** Deno version configuration for exact managed workflow variants. */
import type { ArtifactObservation } from "../api/artifact-inspection.ts";
import type {
  DetectionContext,
  OperationContext,
} from "../api/repository-context.ts";
import { workflowDenoVersion } from "./workflow-toolchain.ts";

const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function validateDenoVersion(value: unknown): string {
  if (
    typeof value !== "string" ||
    !stableVersion.test(value)
  ) {
    throw new Error(
      "deno-version must be an exact stable version, such as 2.9.6.",
    );
  }
  return value;
}

export function workflowDenoArtifact<
  T extends { readonly path: string; readonly content: string },
>(
  artifact: T,
  context: DetectionContext,
  observation: ArtifactObservation,
): T {
  const options = (context as Partial<OperationContext>).options;
  const pins = observation.kind === "file"
    ? [...observation.content.matchAll(/^ {10}deno-version: (.+)$/gm)].map(
      (match) => match[1],
    )
    : [];
  const recorded =
    pins.length && new Set(pins).size === 1 && stableVersion.test(pins[0])
      ? pins[0]
      : undefined;
  const selected = options?.denoVersion ?? recorded ??
    options?.defaultDenoVersion;
  if (selected === undefined) return artifact;
  const version = validateDenoVersion(selected);
  return {
    ...artifact,
    content: artifact.content.replaceAll(
      `deno-version: ${workflowDenoVersion}\n`,
      `deno-version: ${version}\n`,
    ),
  };
}
