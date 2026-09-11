/** @module Lifecycle declarations for generated release publication workflows. */

import type { DetectionIssue } from "../api/feature-detection.ts";
import type { Feature } from "../api/feature.ts";
import type {
  AllowedOperation,
  OperationCheck,
} from "../api/feature-operation.ts";
import type { ChangePlan } from "../api/change-plan.ts";
import type { PlannedChange } from "../api/planned-change.ts";
import type { JsonObject } from "../api/json.ts";
import type {
  DetectionContext,
  GithubProtection,
  OperationContext,
} from "../api/repository-context.ts";
import {
  evaluateReleaseProtection,
  projectRulesets,
} from "../release/effective-protection.ts";
import {
  githubReleasePublishGithubFeatureId,
  githubReleasePublishJsrFeatureId,
  githubReleasePublishTagFeatureId,
} from "../release/names.ts";
import {
  inspectReleaseArtifact,
  publishGithubArtifact,
  publishJsrArtifact,
  publishTagArtifact,
  releaseWorkflowMarker,
} from "./github-release-publish-artifacts.ts";
import {
  jsrReleaseArtifact,
  jsrReleaseMarker,
} from "./jsr-release-artifacts.ts";
import {
  requirePublisherQuiescence,
  requireTagQuiescence,
} from "./release-quiescence.ts";
import {
  mainProtectionDefinition,
  mainReviewDefinition,
  protectedTagsDefinition,
  releaseTagsDefinition,
} from "./github-protection-definitions.ts";

type Artifact = { readonly path: string; readonly content: string };

function releaseFeature(
  id: string,
  name: string,
  artifact: Artifact,
  requires: Feature["dependencies"]["requires"],
  options: {
    readonly tag?: boolean;
    readonly legacy?: boolean;
    readonly releaseContributions?: Feature["releaseContributions"];
  } = {},
): Feature {
  return {
    metadata: { id, name, summary: `Adds the ${name} workflow.` },
    dependencies: { requires },
    conflicts: options.tag
      ? {
        featureIds: ["github-main-review"],
        disableWith: ["github-protected-tags"],
      }
      : undefined,
    capabilities: options.tag
      ? {
        provides: [],
        requires: [{
          capabilityId: "version-provider",
          reason: "Release tags require a version provider.",
        }],
      }
      : { provides: [], requires: [] },
    releaseContributions: options.releaseContributions,
    detect: (context) => detect(context, artifact, options.legacy),
    checkEnable: (context) => checkEnable(context, id, artifact, options),
    planEnable: (context, allowed) =>
      planEnable(context, allowed, id, artifact, options),
    checkDisable: (context) => checkDisable(context, artifact, options),
    planDisable: (context, allowed) =>
      planDisable(context, allowed, id, artifact, options),
  };
}

export const githubReleasePublishTagFeature = releaseFeature(
  githubReleasePublishTagFeatureId,
  "GitHub release tag publication",
  publishTagArtifact,
  [
    { featureId: "git", reason: "Release publication requires Git." },
    {
      featureId: "github-repo",
      reason: "Release publication requires GitHub.",
    },
    { featureId: "github-ci", reason: "Release publication requires CI." },
    {
      featureId: "github-main-protection",
      reason: "Release publication requires main protection.",
    },
    {
      featureId: "github-protected-tags",
      reason: "Release publication requires protected tags.",
    },
    {
      featureId: "deno-fmt",
      reason: "Release publication formats generated data.",
    },
  ],
  { tag: true },
);
export const githubReleasePublishJsrFeature = releaseFeature(
  githubReleasePublishJsrFeatureId,
  "GitHub JSR release publication",
  publishJsrArtifact,
  [
    {
      featureId: githubReleasePublishTagFeatureId,
      reason: "JSR publication starts after a release tag.",
    },
    {
      featureId: "jsr-package",
      reason: "JSR publication requires a JSR package.",
    },
  ],
  {
    legacy: true,
    releaseContributions: [{
      command: "deno",
      args: ["publish", "--dry-run"],
    }],
  },
);
export const githubReleasePublishGithubFeature = releaseFeature(
  githubReleasePublishGithubFeatureId,
  "GitHub Release publication",
  publishGithubArtifact,
  [{
    featureId: githubReleasePublishTagFeatureId,
    reason: "GitHub Releases start after a release tag.",
  }],
);
export const githubReleasePublisherFeatures = [
  githubReleasePublishJsrFeature,
  githubReleasePublishGithubFeature,
] as const;

async function detect(
  context: DetectionContext,
  artifact: Artifact,
  legacy = false,
) {
  const current = await inspectReleaseArtifact(context, artifact);
  if (!legacy) return artifactDetection(current, artifact.path);
  const old = await inspectReleaseArtifact(context, jsrReleaseArtifact);
  if (
    isUnknown(current, releaseWorkflowMarker) ||
    isUnknown(old, jsrReleaseMarker)
  ) {
    return issue("ambiguous", artifact.path, "A release workflow is custom.");
  }
  if (current.result === "absent" && old.result === "absent") {
    return state("disabled", artifact.path);
  }
  if (current.result === "matches" && old.result === "absent") {
    return state("enabled", artifact.path);
  }
  return issue(
    "drifted",
    artifact.path,
    "The JSR release workflow needs migration or repair.",
  );
}

function artifactDetection(
  inspection: Awaited<ReturnType<typeof inspectReleaseArtifact>>,
  path: string,
) {
  if (inspection.result === "absent") return state("disabled", path);
  if (inspection.result === "matches") return state("enabled", path);
  return isUnknown(inspection)
    ? issue("ambiguous", path, "The release workflow is custom.")
    : issue("drifted", path, "The generated release workflow differs.");
}
function state(state: "enabled" | "disabled", path: string) {
  return {
    state,
    evidence: [{
      code: `release-workflow-${state}`,
      kind: "github-workflow",
      subject: { kind: "repository-path", identifier: path },
      observation: path,
    }],
  };
}
function issue(
  state: "drifted" | "ambiguous",
  path: string,
  observation: string,
) {
  const item: DetectionIssue = {
    code: `release-workflow-${state}`,
    kind: "github-workflow",
    subject: { kind: "repository-path", identifier: path },
    observation,
    resolution: state === "drifted"
      ? "Use --repair to restore the generated workflow."
      : "Resolve the custom workflow conflict manually.",
  };
  return { state, evidence: [], issues: [item] };
}
function isUnknown(
  inspection: Awaited<ReturnType<typeof inspectReleaseArtifact>>,
  marker = releaseWorkflowMarker,
): boolean {
  return inspection.result === "unreadable" ||
    inspection.result === "differs" &&
      (inspection.observation.kind !== "file" ||
        !inspection.observation.content.startsWith(marker));
}

async function checkEnable(
  context: OperationContext,
  id: string,
  artifact: Artifact,
  options: { readonly tag?: boolean; readonly legacy?: boolean },
): Promise<OperationCheck> {
  for (const path of [".github", ".github/workflows"]) {
    const entry = await context.files.observe(path);
    if (entry.kind !== "absent" && entry.kind !== "directory") {
      return blocked(
        "release-workflow-parent",
        `Workflow parent ${path} is not a directory.`,
      );
    }
  }
  const current = await inspectReleaseArtifact(context, artifact);
  const legacy = options.legacy
    ? await inspectReleaseArtifact(context, jsrReleaseArtifact)
    : undefined;
  if (
    isUnknown(current, releaseWorkflowMarker) ||
    legacy && isUnknown(legacy, jsrReleaseMarker)
  ) {
    return blocked(
      "release-workflow-custom",
      "A custom release workflow will not be replaced.",
    );
  }
  const repair = context.repair?.kind === "all-drifted" ||
    context.repair?.kind === "features" &&
      context.repair.featureIds.includes(id);
  if (
    (current.result === "differs" || legacy?.result === "differs") && !repair
  ) {
    return blocked(
      "release-workflow-repair",
      "Generated release workflow drift requires --repair.",
    );
  }
  if (options.tag) {
    const protection = await context.github?.protection?.();
    const branch = (await context.github?.repository())?.defaultBranch;
    if (!protection || !branch) {
      return blocked(
        "release-protection-unavailable",
        "Cannot read effective GitHub protection before release enablement.",
      );
    }
    const result = evaluateReleaseProtection(
      projectedProtection(context, protection),
      {
        defaultBranch: branch,
        releaseBranch: "release-0.0.0",
        releaseTag: "0.0.0",
      },
    );
    if (result.kind !== "compatible") {
      return blocked(
        "release-protection-incompatible",
        result.reasons.join(" "),
      );
    }
  }
  return current.result === "matches" && legacy?.result !== "matches"
    ? {
      result: "no-op",
      reason: "Release workflow is already adopted.",
      warnings: [],
    }
    : { result: "allowed", warnings: [], preconditions: [] };
}

function projectedProtection(
  context: OperationContext,
  protection: GithubProtection,
) {
  const enables = new Set(
    context.resolvedChanges.filter((change) => change.enabled).map((change) =>
      change.featureId
    ),
  );
  const replacements = new Map<string, JsonObject | undefined>();
  if (enables.has("github-main-protection")) {
    replacements.set(
      mainProtectionDefinition.name as string,
      mainProtectionDefinition,
    );
  }
  if (enables.has("github-protected-tags")) {
    replacements.set(
      protectedTagsDefinition.name as string,
      protectedTagsDefinition,
    );
    replacements.set(
      releaseTagsDefinition.name as string,
      releaseTagsDefinition,
    );
  }
  if (
    context.resolvedChanges.some((change) =>
      !change.enabled && change.featureId === "github-main-review"
    )
  ) {
    replacements.set(mainReviewDefinition.name as string, undefined);
  }
  if (
    context.resolvedChanges.some((change) =>
      !change.enabled && change.featureId === "github-protected-tags"
    )
  ) {
    replacements.set(protectedTagsDefinition.name as string, undefined);
    replacements.set(releaseTagsDefinition.name as string, undefined);
  }
  return projectRulesets(protection, replacements);
}

async function planEnable(
  context: OperationContext,
  operation: AllowedOperation,
  id: string,
  artifact: Artifact,
  options: { readonly tag?: boolean; readonly legacy?: boolean },
): Promise<ChangePlan> {
  const fresh = await checkEnable(context, id, artifact, options);
  if (fresh.result === "blocked") {
    throw new Error("Release workflow changed after checking.");
  }
  const current = await inspectReleaseArtifact(context, artifact);
  const old = options.legacy
    ? await inspectReleaseArtifact(context, jsrReleaseArtifact)
    : undefined;
  const changes: PlannedChange[] = [];
  for (const path of [".github", ".github/workflows"]) {
    if ((await context.files.observe(path)).kind === "absent") {
      changes.push({ kind: "create-directory", path });
    }
  }
  if (current.result !== "matches") {
    const expectedDigest =
      current.result === "differs" && current.observation.kind === "file"
        ? current.observation.digest
        : undefined;
    changes.push({
      kind: "write-file",
      path: artifact.path,
      content: artifact.content,
      mode: 0o644,
      expectedDigest,
    });
  }
  if (
    (old?.result === "matches" || old?.result === "differs") &&
    old.observation.kind === "file"
  ) {
    changes.push({
      kind: "remove-file",
      path: old.schema.path,
      expectedDigest: old.observation.digest,
    });
  }
  return featurePlan(id, "enable", operation, changes, "enabled");
}

async function checkDisable(
  context: OperationContext,
  artifact: Artifact,
  options: { readonly tag?: boolean; readonly legacy?: boolean },
): Promise<OperationCheck> {
  if (
    options.tag &&
    context.resolvedChanges.some((change) =>
      !change.enabled && change.featureId === "github-protected-tags"
    )
  ) {
    return blocked(
      "release-tag-protection-order",
      "Disable tag publication before protected tags in separate operations.",
    );
  }
  const current = await inspectReleaseArtifact(context, artifact);
  const old = options.legacy
    ? await inspectReleaseArtifact(context, jsrReleaseArtifact)
    : undefined;
  if (
    isUnknown(current, releaseWorkflowMarker) ||
    old && isUnknown(old, jsrReleaseMarker) ||
    current.result === "differs" || old?.result === "differs"
  ) {
    return blocked(
      "release-workflow-custom",
      "Only exact generated release workflows can be removed.",
    );
  }
  const present = [current, old].flatMap((item) =>
    item?.result === "matches" ? [item.schema.path] : []
  );
  const quiescence = present.length === 0
    ? undefined
    : options.tag
    ? await requireTagQuiescence(context.github, artifact.path)
    : await requirePublisherQuiescence(context.github, present);
  if (quiescence) {
    return blocked(
      "release-workflow-quiescence-unavailable",
      quiescence,
    );
  }
  if (present.length) {
    return { result: "allowed", warnings: [], preconditions: [] };
  }
  return {
    result: "no-op",
    reason: "Release workflow is absent.",
    warnings: [],
  };
}

async function planDisable(
  context: OperationContext,
  operation: AllowedOperation,
  id: string,
  artifact: Artifact,
  options: { readonly tag?: boolean; readonly legacy?: boolean },
): Promise<ChangePlan> {
  const fresh = await checkDisable(context, artifact, options);
  if (fresh.result === "blocked") {
    throw new Error("Release workflow changed after checking.");
  }
  const inspections = [
    await inspectReleaseArtifact(context, artifact),
    ...(options.legacy
      ? [await inspectReleaseArtifact(context, jsrReleaseArtifact)]
      : []),
  ];
  const changes: PlannedChange[] = inspections.flatMap((
    item,
  ): PlannedChange[] =>
    item.result === "matches" && item.observation.kind === "file"
      ? [{
        kind: "remove-file",
        path: item.schema.path,
        expectedDigest: item.observation.digest,
      }]
      : []
  );
  return featurePlan(id, "disable", operation, changes, "disabled");
}
function featurePlan(
  id: string,
  action: "enable" | "disable",
  operation: AllowedOperation,
  changes: readonly PlannedChange[],
  expected: "enabled" | "disabled",
): ChangePlan {
  return {
    featureId: id,
    action,
    summary: `${
      action === "enable" ? "Configure" : "Remove"
    } release workflow.`,
    warnings: operation.warnings,
    preconditions: operation.preconditions,
    changes,
    validations: [{ kind: "feature-redetection", featureId: id, expected }],
  };
}
function blocked(code: string, message: string): OperationCheck {
  return {
    result: "blocked",
    blockers: [{
      code,
      message,
      subjects: [],
      resolution: "Resolve release workflow state before continuing.",
    }],
    warnings: [],
  };
}
