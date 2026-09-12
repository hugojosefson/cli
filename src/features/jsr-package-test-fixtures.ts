import {
  makeTempDir,
  remove,
  writeTextFile,
} from "../testing/files-test-fixtures.ts";
/** @module Shared fixtures for JSR package feature tests. */

import type { OperationContext } from "../api/repository-context.ts";
import { LocalFileReader } from "../repository/local-file-reader.ts";
import {
  denoTaskDefinitions,
  leafTaskDefinitions,
  leafTaskNames,
  readmeTaskDefinition,
  type TaskFeatureId,
} from "./deno-tasks.ts";
import { publishCheckDefinition } from "./jsr-package-config.ts";

export function context(
  root: URL,
  repair: OperationContext["repair"] = undefined,
  enabled: readonly string[] = [],
  jsrEnabled = true,
): OperationContext {
  return {
    repositoryRoot: root,
    files: new LocalFileReader(root),
    git: {
      isRepository: () => Promise.resolve(false),
      head: () => Promise.resolve(undefined),
      status: () => Promise.resolve(undefined),
      remotes: () => Promise.resolve([]),
      defaultBranch: () => Promise.resolve(undefined),
    },
    github: {
      repository: () => Promise.resolve({ owner: "Owner", name: "Repository" }),
      rulesets: () => Promise.resolve([]),
      environments: () => Promise.resolve([]),
      variables: () => Promise.resolve([]),
      secretExists: () => Promise.resolve(false),
      resource: () => Promise.resolve(undefined),
    },
    detections: new Map(),
    requestedChanges: [],
    resolvedChanges: [
      ...enabled.map((featureId) => ({
        featureId,
        enabled: true,
        reason: { kind: "explicit-request" } as const,
      })),
      {
        featureId: "jsr-package",
        enabled: jsrEnabled,
        reason: { kind: "explicit-request" },
      },
    ],
    repair,
    options: { jsrScope: "owner" },
  };
}

export async function writeConfig(root: URL, value: unknown): Promise<void> {
  await writeTextFile(new URL("deno.json", root), JSON.stringify(value));
}

export function ownedTasks(
  leafs: readonly TaskFeatureId[] = [],
  readme = false,
): Record<string, unknown> {
  return {
    ...Object.fromEntries(
      leafs.map((id) => [leafTaskNames[id], leafTaskDefinitions[id]]),
    ),
    ...(readme ? { readme: readmeTaskDefinition } : {}),
    "publish-check": publishCheckDefinition,
    check: denoTaskDefinitions(leafs, readme, true).check,
  };
}

export async function withRepository(
  action: (root: URL) => Promise<void>,
): Promise<void> {
  const path = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-jsr-",
  });
  try {
    await action(new URL(`file://${path}/`));
  } finally {
    await remove(path, { recursive: true });
  }
}
