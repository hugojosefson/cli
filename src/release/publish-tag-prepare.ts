/** @module Production publisher contributions for release preparation. */
import type { ReleaseContribution } from "../api/feature.ts";
import { githubReleasePublisherFeatures } from "../features/github-release-publish-feature.ts";
import { LocalGitReader } from "../repository/local-git-reader.ts";
import type { LocalFileReader } from "../repository/local-file-reader.ts";
import { readDenoConfig } from "../repository/read-deno-config.ts";
import { jsrPublishOptions } from "./jsr-publish-options.ts";
import type { ReleaseEnvironment } from "./release-environment.ts";
import type { ReleaseProcess } from "./release-process.ts";
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
  return prepareRelease(root, environment, process, planReleaseContributions);
}

/** Checks publishers before candidate edits or project validation starts. */
async function planReleaseContributions(
  root: URL,
  files: LocalFileReader,
): Promise<readonly ReleaseContribution[]> {
  const commands: ReleaseContribution[] = [];
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
    const options = feature.metadata.id === "github-release-publish-jsr"
      ? await jsrOptions(files)
      : [];
    for (const contribution of contributions) {
      commands.push({
        command: contribution.command,
        args: [...contribution.args, ...options],
      });
    }
  }
  return commands;
}

async function jsrOptions(files: LocalFileReader): Promise<string[]> {
  const config = await readDenoConfig({ files });
  if (config.kind !== "config") {
    throw new TypeError(
      "JSR release preparation requires one Deno configuration.",
    );
  }
  return jsrPublishOptions(config.value);
}
