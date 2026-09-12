/** Exact legacy server adapter, retained only for guarded migration. */
import { matchesFileAccess } from "../repository/file-access.ts";
import type { DetectionContext } from "../api/repository-context.ts";
import type { PlannedChange } from "../api/planned-change.ts";
import type { ExactArtifactInspection } from "../api/artifact-inspection.ts";
import { denoCliArtifactsForServer } from "./deno-cli-artifacts.ts";

export const legacyServerAdapter = {
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
};

export async function removeLegacyServerAdapter(
  context: DetectionContext,
): Promise<readonly PlannedChange[]> {
  const file = await context.files.observe(legacyServerAdapter.path);
  return file.kind === "file" && matchesFileAccess(file, 0o644) &&
      file.content === legacyServerAdapter.content
    ? [{
      kind: "remove-file",
      path: legacyServerAdapter.path,
      expectedDigest: file.digest,
    }]
    : [];
}

export function legacyServerRegistry(
  inspection: ExactArtifactInspection,
): boolean {
  const registry = denoCliArtifactsForServer(true).find((item) =>
    item.path === "src/cli/commands.ts"
  )!;
  return inspection.result === "differs" &&
    inspection.observation.kind === "file" &&
    matchesFileAccess(inspection.observation, registry.mode) &&
    inspection.observation.content ===
      registry.content.replace(
        '"./serve-command.ts"',
        '"../server/serve-command.ts"',
      );
}
