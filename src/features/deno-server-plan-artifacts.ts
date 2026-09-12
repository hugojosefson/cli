import {
  matchesFileAccess,
  repairFileMode,
} from "../repository/file-access.ts";
import type { PlannedChange } from "../api/planned-change.ts";
import {
  denoCliServerPaths,
  type inspectDenoCliArtifacts,
} from "./deno-cli-artifacts.ts";
import {
  denoServerArtifacts,
  type inspectDenoServerArtifacts,
} from "./deno-server-artifacts.ts";

export function addServerArtifacts(
  changes: PlannedChange[],
  inspections: readonly Awaited<
    ReturnType<typeof inspectDenoServerArtifacts>
  >[number][],
) {
  for (const [index, item] of inspections.entries()) {
    if (item.result === "matches") continue;
    if (item.result === "absent") {
      changes.push({
        kind: "write-file",
        path: denoServerArtifacts[index].path,
        content: denoServerArtifacts[index].content,
        mode: denoServerArtifacts[index].mode,
        expectedDigest: undefined,
      });
    } else if (item.result === "differs" && item.observation.kind === "file") {
      if (
        item.differences.some((difference) => difference.kind === "content")
      ) {
        changes.push({
          kind: "write-file",
          path: denoServerArtifacts[index].path,
          content: denoServerArtifacts[index].content,
          mode: denoServerArtifacts[index].mode,
          expectedDigest: item.observation.digest,
        });
      }
      if (
        !matchesFileAccess(item.observation, denoServerArtifacts[index].mode)
      ) {
        changes.push({
          kind: "set-file-mode",
          path: denoServerArtifacts[index].path,
          mode: repairFileMode(
            item.observation,
            denoServerArtifacts[index].mode,
          ),
          expectedMode: item.observation.mode,
        });
      }
    }
  }
}

export function addServerCliArtifacts(
  changes: PlannedChange[],
  inspections: readonly Awaited<
    ReturnType<typeof inspectDenoCliArtifacts>
  >[number][],
) {
  for (
    const item of inspections.filter((entry) =>
      denoCliServerPaths.includes(entry.schema.path)
    )
  ) {
    const artifact = item.schema;
    if (artifact.kind !== "file") {
      throw new Error("Expected CLI file artifact.");
    }
    if (item.result === "absent") {
      changes.push({
        kind: "write-file",
        path: artifact.path,
        content: artifact.content,
        mode: artifact.mode,
        expectedDigest: undefined,
      });
    } else if (item.result === "differs" && item.observation.kind === "file") {
      changes.push({
        kind: "write-file",
        path: artifact.path,
        content: artifact.content,
        mode: artifact.mode,
        expectedDigest: item.observation.digest,
      });
    }
  }
}
