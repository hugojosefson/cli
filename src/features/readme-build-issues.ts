/** @module Paths and values that prevent README build inspection. */

import { fileDifference } from "./detection-differences.ts";
import type { DetectionIssue } from "../api/feature-detection.ts";
import type { DetectionContext } from "../api/repository-context.ts";
import { readmeBuildConfigIssues } from "./readme-build-config-issues.ts";
import { readmeBuildIssue as issue } from "./readme-build-issue.ts";
import type { inspectReadmeBuild } from "./readme-build-state.ts";

type State = Awaited<ReturnType<typeof inspectReadmeBuild>>;

export async function readmeBuildIssues(
  state: State,
  context: DetectionContext,
): Promise<DetectionIssue[]> {
  if (state.legacy.kind === "conflict") {
    return [
      issue(
        "readme/generate-readme.ts",
        state.legacy.reason,
        "Automatic migration is unavailable. Examine readme/generate-readme.ts and the @@include directives in readme/README.md. Preserve custom generator behavior.",
      ),
    ];
  }
  const issues: DetectionIssue[] = [];
  if (state.source.kind !== "file") {
    const path = state.directory.kind === "directory"
      ? "readme/README.md"
      : "readme";
    issues.push(
      issue(
        path,
        fileDifference(path, state.source),
        "Supply readme/README.md as a readable regular file in a regular readme directory. Preserve existing files before replacing a path.",
      ),
    );
  } else if (state.output === undefined) {
    issues.push(
      issue(
        "readme/README.md",
        state.outputError ??
          "Expected README output. Found an unavailable build result.",
        "Use hj readme build to get the source error. Correct the reported include path or package reference.",
      ),
    );
  }
  if (state.root.kind !== "file" && state.root.kind !== "absent") {
    issues.push(
      issue(
        "README.md",
        fileDifference("README.md", state.root),
        "Supply README.md as a regular file, or move the conflicting path to preserve its contents.",
      ),
    );
  }
  return [...issues, ...await readmeBuildConfigIssues(state, context)];
}
