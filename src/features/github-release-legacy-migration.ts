/** @module Guarded conversion from git-hj-init to coordinated publication. */

import type { Precondition } from "../api/change-plan.ts";
import type { OperationContext } from "../api/repository-context.ts";
import type { PlannedChange } from "../api/planned-change.ts";
import { inspectLegacyRelease } from "./github-release-legacy.ts";
import { inspectGithubCiArtifacts } from "./github-ci-artifacts.ts";
import { legacyCiCheckCompatibility } from "./github-ci-legacy.ts";
import {
  inspectReleaseArtifact,
  publishJsrArtifact,
  publishTagArtifact,
} from "./github-release-publish-artifacts.ts";
import { jsrReleaseArtifact } from "./jsr-release-artifacts.ts";
import { requirePublisherQuiescence } from "./release-quiescence.ts";

export const legacyReleaseMigrationSummary =
  "Replace release.yaml and its release:*, release, version, and git-is-clean tasks with coordinated tag and JSR publication. Retain the CI test and check names.";

export async function checkLegacyReleaseMigration(
  context: OperationContext,
): Promise<string | undefined> {
  const legacy = await inspectLegacyRelease(context);
  if (legacy.kind === "absent") return;
  if (legacy.kind !== "exact") {
    return "Legacy release workflow or tasks are edited, incomplete, or unavailable. Preserve them and resolve the release bundle manually.";
  }
  const destinations = await Promise.all(
    [publishTagArtifact, publishJsrArtifact, jsrReleaseArtifact].map(
      (artifact) => inspectReleaseArtifact(context, artifact),
    ),
  );
  if (
    destinations.some((item) =>
      item.result !== "absent" && item.result !== "matches"
    )
  ) {
    return "A release workflow destination is edited or unavailable. Resolve the collision before migration.";
  }
  const enabled = (id: string) =>
    context.resolvedChanges.some((change) =>
      change.enabled && change.featureId === id
    );
  if (!enabled("github-release-publish-jsr")) {
    return "Select --github-release-publish-jsr to migrate the legacy release bundle together.";
  }
  if (
    !enabled("github-release-publish-tag") &&
    (await inspectReleaseArtifact(context, publishTagArtifact)).result !==
      "matches"
  ) {
    return "Select --github-release-publish-tag with the JSR publisher to replace legacy tag creation.";
  }
  const ci = await inspectGithubCiArtifacts(context);
  if (
    ci.some((item) => item.result !== "matches" && item.result !== "absent")
  ) {
    return "A CI workflow destination is edited or unavailable. Resolve the collision before migration.";
  }
  if (
    !enabled("github-ci") && !ci.every((item) =>
      item.result === "matches" &&
      (item.schema.path.endsWith("/hj-ci.yaml")
        ? item.schema.kind === "file" &&
          item.schema.content.endsWith(legacyCiCheckCompatibility)
        : true)
    )
  ) {
    return "Select --github-ci with the JSR publisher to retain the required test and check names.";
  }
  return await requirePublisherQuiescence(context.github, [
    legacy.workflow.schema.path,
    ...(destinations[2].result === "matches" ? [jsrReleaseArtifact.path] : []),
  ]);
}

export async function legacyReleaseMigrationChanges(
  context: OperationContext,
): Promise<PlannedChange[]> {
  const legacy = await inspectLegacyRelease(context);
  if (legacy.kind === "absent") return [];
  if (
    legacy.kind !== "exact" || legacy.workflow.result !== "matches" ||
    legacy.workflow.observation.kind !== "file" ||
    legacy.config.kind !== "config"
  ) throw new Error("Legacy release bundle changed before migration.");
  return [
    {
      kind: "remove-file",
      path: legacy.workflow.schema.path,
      expectedDigest: legacy.workflow.observation.digest,
    },
    ...legacy.entries.map(([name, expected]): PlannedChange => ({
      kind: "remove-json",
      path: legacy.config.kind === "config" ? legacy.config.path : "deno.jsonc",
      jsonPath: ["tasks", name],
      expected,
    })),
  ];
}

/** Guard unchanged companion workflows that no earlier feature plan replaces. */
export async function legacyReleaseCompanionPreconditions(
  context: OperationContext,
): Promise<Precondition[]> {
  const enabled = new Set(
    context.resolvedChanges.filter((change) => change.enabled).map((change) =>
      change.featureId
    ),
  );
  const companions = [
    ...(!enabled.has("github-release-publish-tag")
      ? [await inspectReleaseArtifact(context, publishTagArtifact)]
      : []),
    ...(!enabled.has("github-ci")
      ? await inspectGithubCiArtifacts(context)
      : []),
  ];
  return companions.map((item) => ({
    kind: "file-digest",
    path: item.schema.path,
    digest: item.result === "matches" && item.observation.kind === "file"
      ? item.observation.digest
      : undefined,
  }));
}
