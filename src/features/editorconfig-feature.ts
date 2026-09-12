/** @module Independently selectable, guarded EditorConfig defaults. */
import type { ChangePlan } from "../api/change-plan.ts";
import type { FeatureDetection } from "../api/feature-detection.ts";
import type {
  AllowedOperation,
  OperationCheck,
} from "../api/feature-operation.ts";
import type { Feature } from "../api/feature.ts";
import type {
  DetectionContext,
  OperationContext,
} from "../api/repository-context.ts";
import {
  editorconfigComplete,
  editorconfigOwnershipPath,
  editorconfigPath,
  readEditorconfigOwnership,
  updateEditorconfig,
} from "./editorconfig-content.ts";

const id = "editorconfig";
const subject = { kind: "file", identifier: editorconfigPath };
async function inspect(context: DetectionContext) {
  const observations = await Promise.all(
    [editorconfigPath, editorconfigOwnershipPath].map(async (path) => {
      const file = await context.files.observe(path);
      if (file.kind !== "file" && file.kind !== "absent") {
        throw new Error(`${path} must be a regular file.`);
      }
      return {
        path,
        content: file.kind === "file" ? file.content : undefined,
        digest: file.kind === "file" ? file.digest : undefined,
      };
    }),
  );
  const content = observations[0]!.content ?? "";
  const ownership = readEditorconfigOwnership(observations[1]!.content);
  return { observations, content, ownership };
}
function detection(
  state: FeatureDetection["state"],
  observation: string,
): FeatureDetection {
  const evidence = [{
    code: `editorconfig-${state}`,
    kind: id,
    subject,
    observation,
  }];
  return state === "enabled" || state === "disabled" ? { state, evidence } : {
    state,
    evidence,
    issues: [{
      ...evidence[0]!,
      resolution: "Review the file and enable or repair editorconfig.",
    }],
  };
}
async function detect(context: DetectionContext): Promise<FeatureDetection> {
  try {
    const { content, ownership } = await inspect(context);
    if (editorconfigComplete(content, ownership)) {
      return detection(
        "enabled",
        "EditorConfig defaults or custom values are configured.",
      );
    }
    return ownership
      ? detection(
        "drifted",
        "Owned EditorConfig entries changed or are missing.",
      )
      : detection("disabled", "EditorConfig defaults are not configured.");
  } catch (error) {
    return detection("ambiguous", (error as Error).message);
  }
}
async function plan(
  context: OperationContext,
  enabled: boolean,
  allowed: AllowedOperation,
): Promise<ChangePlan> {
  const { observations, content, ownership } = await inspect(context);
  const desired = updateEditorconfig(content, ownership, enabled);
  const contents = [
    desired.content || undefined,
    desired.ownership
      ? `${JSON.stringify(desired.ownership, null, 2)}\n`
      : undefined,
  ];
  const directory = await context.files.observe(".hj");
  const createDirectory = desired.ownership && directory.kind === "absent";
  return {
    featureId: id,
    action: enabled ? "enable" : "disable",
    summary: enabled
      ? "Add missing EditorConfig defaults."
      : "Remove unchanged owned EditorConfig content.",
    warnings: allowed.warnings,
    preconditions: observations.map(({ path, digest }) => ({
      kind: "file-digest",
      path,
      digest,
    })),
    changes: [
      ...(createDirectory
        ? [{ kind: "create-directory" as const, path: ".hj" }]
        : []),
      ...observations.flatMap(
        (file, index): ChangePlan["changes"][number][] => {
          const next = contents[index];
          if (next === file.content) return [];
          if (next === undefined) {
            return file.digest === undefined ? [] : [{
              kind: "remove-file",
              path: file.path,
              expectedDigest: file.digest,
            }];
          }
          return [{
            kind: "write-file",
            path: file.path,
            content: next,
            expectedDigest: file.digest,
          }];
        },
      ),
    ],
    // Custom complete files remain enabled after their owned additions leave.
    validations: enabled
      ? [{ kind: "feature-redetection", featureId: id, expected: "enabled" }]
      : [],
  };
}
async function check(
  context: OperationContext,
  enabled: boolean,
): Promise<OperationCheck> {
  try {
    const result = await plan(context, enabled, {
      result: "allowed",
      warnings: [],
      preconditions: [],
    });
    return result.changes.length
      ? { result: "allowed", warnings: [], preconditions: result.preconditions }
      : {
        result: "no-op",
        warnings: [],
        reason: "EditorConfig already matches.",
      };
  } catch (error) {
    return {
      result: "blocked",
      warnings: [],
      blockers: [{
        code: "editorconfig-conflict",
        message: (error as Error).message,
        subjects: [subject],
        resolution: "Resolve the file or ownership conflict, then retry.",
      }],
    };
  }
}
/** Adds defaults without Git or Deno requirements and preserves custom settings. */
export const editorconfigFeature: Feature = {
  metadata: {
    id,
    name: "EditorConfig",
    summary: "Set consistent editor defaults while preserving custom settings.",
  },
  dependencies: { requires: [] },
  capabilities: { provides: [], requires: [] },
  detect,
  checkEnable: (context) => check(context, true),
  checkDisable: (context) => check(context, false),
  planEnable: (context, allowed) => plan(context, true, allowed),
  planDisable: (context, allowed) => plan(context, false, allowed),
};
