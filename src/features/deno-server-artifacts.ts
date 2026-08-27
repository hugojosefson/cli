/** @module Exact starter artifacts contributed by the Deno server feature. */

import type {
  ArtifactSchema,
  ExactArtifactInspection,
} from "../api/artifact-inspection.ts";
import type { DetectionContext } from "../api/repository-context.ts";
import { inspectArtifact } from "../artifacts/inspect-artifact.ts";

export const denoServerFeatureId = "deno-server";
export const denoServerExport = "./src/server/server.ts";
export const denoServerInitialConfigContribution = {
  featureId: denoServerFeatureId,
  value: { exports: { "./server": denoServerExport } },
};
export const denoServerArtifacts = [{
  path: "src/server/server.ts",
  content: `export function handler(_request: Request): Response {
  return new Response("Hello from Deno.serve.");
}

if (import.meta.main) {
  Deno.serve(handler);
}
`,
  mode: 0o644,
}, {
  path: "src/server/serve-command.ts",
  content: `import { handler } from "./server.ts";

export const serveCommand = {
  name: "serve",
  description: "Start the server.",
  run: async () => {
    const permission = await Deno.permissions.request({
      name: "net",
      host: "0.0.0.0:8000",
    });
    if (permission.state !== "granted") {
      return "Network permission denied.";
    }
    Deno.serve(handler);
    return "Server started.";
  },
};
`,
  mode: 0o644,
}, {
  path: "test/server_test.ts",
  content: `import { handler } from "../src/server/server.ts";

Deno.test("server handler responds", async () => {
  const response = handler(new Request("http://localhost/"));
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
