/** @module Production publisher contributions for release preparation. */
import { githubReleasePublisherFeatures } from "../features/github-release-publish-feature.ts";
import { LocalGitReader } from "../repository/local-git-reader.ts";
import type { LocalFileReader } from "../repository/local-file-reader.ts";
import type { ReleaseEnvironment } from "./release-environment.ts";
import { type ReleaseProcess, runOrThrow } from "./release-process.ts";
import {
  prepareRelease,
  type PublishTagPrepareResult,
} from "./publish-tag-prepare-core.ts";
export type { PublishTagPrepareResult } from "./publish-tag-prepare-core.ts";

export function publishTagPrepare(
  root: URL,
  environment: ReleaseEnvironment,
  process: ReleaseProcess,
): Promise<PublishTagPrepareResult> {
  return prepareRelease(root, environment, process, runReleaseContributions);
}

/** Runs only contributions whose generated publisher workflow is exact. */
async function runReleaseContributions(
  root: URL,
  files: LocalFileReader,
  process: ReleaseProcess,
): Promise<void> {
  const context = {
    repositoryRoot: root,
    files,
    git: new LocalGitReader(root),
  };
  for (const feature of githubReleasePublisherFeatures) {
    const contributions = feature.releaseContributions ?? [];
    if (contributions.length === 0) continue;
    const detection = await feature.detect(context);
    if (detection.state === "disabled") continue;
    if (detection.state !== "enabled") {
      throw new Error(
        `${feature.metadata.id} must be exact before release preparation.`,
      );
    }
    for (const contribution of contributions) {
      await runOrThrow(
        process,
        contribution.command,
        [...contribution.args],
      );
    }
  }
}
