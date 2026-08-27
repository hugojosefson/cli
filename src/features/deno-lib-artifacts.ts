/** @module Exact starter artifacts contributed by the Deno library feature. */

import type {
  ArtifactSchema,
  ExactArtifactInspection,
} from "../api/artifact-inspection.ts";
import type { DetectionContext } from "../api/repository-context.ts";
import { inspectArtifact } from "../artifacts/inspect-artifact.ts";

export const denoLibFeatureId = "deno-lib";
export const denoLibExport = "./src/lib/mod.ts";
/** Declarative config included when Deno config is first created with this feature. */
export const denoLibInitialConfigContribution = {
  featureId: denoLibFeatureId,
  value: { exports: { ".": denoLibExport } },
};
export const denoLibArtifacts = [
  {
    path: "src/lib/mod.ts",
    content: "export function placeholder(): void {}\n",
  },
  {
    path: "test/lib_test.ts",
    content:
      'import { placeholder } from "../src/lib/mod.ts";\n\nDeno.test("placeholder", () => {\n  placeholder();\n});\n',
  },
] as const;

export type DenoLibArtifactInspection = readonly ExactArtifactInspection[];

/** Inspects both starter files with their content and regular-file mode. */
export async function inspectDenoLibArtifacts(
  context: DetectionContext,
): Promise<DenoLibArtifactInspection> {
  return await Promise.all(denoLibArtifacts.map(async (artifact) => {
    const schema: ArtifactSchema = { kind: "file", ...artifact, mode: 0o644 };
    return inspectArtifact(schema, await context.files.observe(artifact.path));
  }));
}

export function denoLibSubject() {
  return { kind: "repository-path", identifier: "deno.json|deno.jsonc" };
}
