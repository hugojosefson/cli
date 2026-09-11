/** @module Exact starter artifacts contributed by the Deno server feature. */

import type {
  ArtifactSchema,
  ExactArtifactInspection,
} from "../api/artifact-inspection.ts";
import { denoServerTasks } from "./deno-server-tasks.ts";
import type { DetectionContext } from "../api/repository-context.ts";
import { inspectArtifact } from "../artifacts/inspect-artifact.ts";

export const denoServerFeatureId = "deno-server";
export const denoServerExport = "./src/server/server.ts";
export const denoServerInitialConfigContribution = {
  featureId: denoServerFeatureId,
  value: { exports: { "./server": denoServerExport }, tasks: denoServerTasks },
};
export const denoServerArtifacts = [{
  path: "src/server/server.ts",
  content: `export default {
  fetch(_request: Request): Response {
    return new Response("Hello from Deno.serve.");
  },
} satisfies Deno.ServeDefaultExport;
`,
  mode: 0o644,
}, {
  path: "test/server_test.ts",
  content: `import server from "../src/server/server.ts";

Deno.test("server handler responds", async () => {
  const response = server.fetch(new Request("http://localhost/"));
  if (!response.ok || await response.text() !== "Hello from Deno.serve.") {
    throw new Error("expected the generated server response");
  }
});
`,
  mode: 0o644,
}] as const;

export async function inspectDenoServerArtifacts(
  context: DetectionContext,
): Promise<readonly ExactArtifactInspection[]> {
  return await Promise.all(denoServerArtifacts.map(async (artifact) => {
    const schema: ArtifactSchema = { kind: "file", ...artifact };
    return inspectArtifact(schema, await context.files.observe(artifact.path));
  }));
}

export function denoServerSubject() {
  return { kind: "repository-path", identifier: "deno.json|deno.jsonc" };
}
