/** @module Exact starter README declaration and inspection. */

import { readPackageMetadata } from "../package/metadata.ts";
import { basename } from "@std/path";
import type {
  ArtifactSchema,
  ExactArtifactInspection,
} from "../api/artifact-inspection.ts";
import type { DetectionIssue } from "../api/feature-detection.ts";
import type { OperationBlocker } from "../api/feature-operation.ts";
import type { DetectionContext } from "../api/repository-context.ts";
import { inspectArtifact } from "../artifacts/inspect-artifact.ts";
import { repositoryRoot } from "../repository/repository-path.ts";

export const readmeStaticFeatureId = "readme-static";
export const readmeStaticPath = "README.md";

/** Returns the exact starter README schema for a repository. */
export async function readmeStaticSchema(
  context: DetectionContext,
): Promise<ArtifactSchema> {
  let name = directoryName(context.repositoryRoot);
  try {
    name = (await readPackageMetadata(context)).name;
  } catch {
    // A README can be created before package metadata is configured.
  }
  return {
    kind: "file",
    path: readmeStaticPath,
    content: `# ${name}\n`,
    mode: 0o644,
  };
}

/** Inspects README.md against its exact starter schema. */
export async function inspectReadmeStatic(
  context: DetectionContext,
): Promise<ExactArtifactInspection> {
  const schema = await readmeStaticSchema(context);
  return inspectArtifact(schema, await context.files.observe(schema.path));
}

export function readmeStaticSubject() {
  return { kind: "repository-path", identifier: readmeStaticPath };
}

export function readmeStaticIssue(
  inspection: ExactArtifactInspection,
): DetectionIssue {
  if (inspection.result === "unreadable") {
    return {
      code: "readme-static-unreadable",
      kind: "readme-static",
      subject: readmeStaticSubject(),
      observation: inspection.observation,
      resolution: ambiguousResolution(),
    };
  }
  if (
    inspection.result === "differs" && inspection.observation.kind !== "file"
  ) {
    return {
      code: "readme-static-ambiguous-kind",
      kind: "readme-static",
      subject: readmeStaticSubject(),
      observation:
        `README.md is a ${inspection.observation.kind}, not a regular file.`,
      resolution: ambiguousResolution(),
    };
  }
  return {
    code: "readme-static-drifted",
    kind: "readme-static",
    subject: readmeStaticSubject(),
    observation: "README.md does not exactly match the starter README.",
    resolution:
      "Repair README.md to exactly match the starter content and mode 0644.",
  };
}

export function readmeStaticBlocker(
  inspection: ExactArtifactInspection,
): OperationBlocker {
  const issue = readmeStaticIssue(inspection);
  return {
    code: issue.code,
    message: issue.observation,
    subjects: [issue.subject],
    resolution: issue.resolution,
  };
}

function directoryName(repositoryUrl: URL): string {
  const name = basename(repositoryRoot(repositoryUrl).path);
  if (!name || /[\0\r\n]/.test(name)) {
    throw new TypeError("Repository root must have a safe directory name.");
  }
  return name;
}

function ambiguousResolution(): string {
  return "Replace the ambiguous README.md entry with the exact regular starter README file, then retry.";
}
