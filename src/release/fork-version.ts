/** @module Minimal read-only adapter for exactly fork-version 6.3.1. */

import { getNextVersion, Logger } from "fork-version";
import type { Config, ForkConfig } from "fork-version";
import type { ReleaseType } from "./release-type.ts";

export const forkVersionVersion = "6.3.1";

/** Calculates a version without letting fork-version inspect commits, write, commit, or tag. */
export async function nextVersion(
  currentVersion: string,
  releaseAs: ReleaseType,
): Promise<string> {
  const config: Config = { currentVersion, releaseAs, silent: true };
  const resolved = config as ForkConfig;
  const next = await getNextVersion(
    resolved,
    new Logger(resolved),
    [],
    currentVersion,
  );
  return next.version;
}
