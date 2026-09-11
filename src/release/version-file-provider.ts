/** @module Selects exactly one release version-file provider. */

import type { RepositoryPath } from "../api/json.ts";
import type { DetectionContext } from "../api/repository-context.ts";
import { inspectDenoConfig } from "../features/deno-config.ts";
import { parseSemver } from "./semver.ts";

export type VersionFile = {
  readonly path: RepositoryPath;
  readonly version: string;
};

export type VersionFileProvider = {
  readonly id: string;
  versionFile(): Promise<VersionFile | undefined>;
};

export type VersionFileSelection =
  | {
    readonly kind: "selected";
    readonly provider: VersionFileProvider;
    readonly file: VersionFile;
  }
  | { readonly kind: "missing" }
  | { readonly kind: "ambiguous"; readonly providerIds: readonly string[] };

/** Provides the SemVer `version` in an unambiguous Deno configuration file. */
export function denoConfigVersionFileProvider(
  context: DetectionContext,
): VersionFileProvider {
  return {
    id: "deno-config",
    async versionFile(): Promise<VersionFile | undefined> {
      const config = await inspectDenoConfig(context);
      if (
        config.kind !== "config" || typeof config.value.version !== "string" ||
        !parseSemver(config.value.version)
      ) {
        return undefined;
      }
      return { path: config.path, version: config.value.version };
    },
  };
}

/** Selects the sole provider with a readable release version. */
export async function selectVersionFileProvider(
  providers: readonly VersionFileProvider[],
): Promise<VersionFileSelection> {
  const results = await Promise.all(providers.map(async (provider) => ({
    provider,
    file: await provider.versionFile(),
  })));
  const available = results.filter(isAvailable);
  if (available.length === 0) {
    return { kind: "missing" };
  }
  if (available.length > 1) {
    return {
      kind: "ambiguous",
      providerIds: available.map((item) => item.provider.id).sort(),
    };
  }
  return { kind: "selected", ...available[0] };
}

function isAvailable(item: {
  readonly provider: VersionFileProvider;
  readonly file: VersionFile | undefined;
}): item is {
  readonly provider: VersionFileProvider;
  readonly file: VersionFile;
} {
  return item.file !== undefined;
}
