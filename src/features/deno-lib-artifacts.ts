/** @module Exact starter artifacts contributed by the Deno library feature. */

import type {
  ArtifactSchema,
  ExactArtifactInspection,
} from "../api/artifact-inspection.ts";
import type { DetectionContext } from "../api/repository-context.ts";
import { inspectArtifact } from "../artifacts/inspect-artifact.ts";

export const denoLibFeatureId = "deno-lib";
export const denoLibExport = "./src/lib/mod.ts";
export const denoLibAssertImport = "jsr:@std/assert@^1.0.19";
/** Declarative config included when Deno config is first created with this feature. */
export const denoLibInitialConfigContribution = {
  featureId: denoLibFeatureId,
  value: {
    exports: { ".": denoLibExport },
    imports: { "@std/assert": denoLibAssertImport },
  },
};
export const denoLibArtifacts = [
  {
    path: "src/lib/mod.ts",
    content: "export function placeholder(): void {}\n",
  },
  {
    path: "test/lib_test.ts",
    content:
      'import { assertEquals } from "@std/assert";\nimport { placeholder } from "../src/lib/mod.ts";\n\nDeno.test("placeholder", async (t) => {\n  await t.step("should not throw", placeholder);\n\n  await t.step("should return undefined", () => {\n    assertEquals(placeholder(), undefined);\n  });\n});\n',
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

/** Existing tests belong to the project, including their content and mode. */
export function isPreservedDenoLibTest(item: ExactArtifactInspection): boolean {
  return item.schema.path === "test/lib_test.ts" &&
    (item.result === "matches" || item.result === "differs") &&
    item.observation.kind === "file";
}

/** New and unchanged assertion starters require a resolvable assertion import. */
export async function needsDenoLibAssert(
  context: DetectionContext,
): Promise<boolean> {
  const test = await context.files.observe("test/lib_test.ts");
  return test.kind === "absent" ||
    test.kind === "file" && test.content === denoLibArtifacts[1].content;
}
