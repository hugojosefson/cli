/** @module GitHub pull-request CI and dependency-update workflow feature. */

import { inspectLegacyReleaseWorkflow } from "./github-release-legacy.ts";
import { legacyCiCheckCompatibility } from "./github-ci-legacy.ts";
import { inspectLegacyGithubCi } from "./github-ci-legacy.ts";
import type { DetectionIssue } from "../api/feature-detection.ts";
import type { DetectionContext } from "../api/repository-context.ts";
import type { Feature } from "../api/feature.ts";
import {
  githubCiFeatureId,
  githubCiMarker,
  githubCiPermissionName,
  githubCiPermissionResource,
  githubCiSubject,
  inspectGithubCiArtifacts,
} from "./github-ci-artifacts.ts";
import {
  checkDisableGithubCi,
  checkEnableGithubCi,
  planDisableGithubCi,
  planEnableGithubCi,
} from "./github-ci-operations.ts";

async function detectGithubCi(context: DetectionContext) {
  const legacy = await inspectLegacyGithubCi(context);
  if (
    legacy.some((item) => item.result !== "absent" && item.result !== "matches")
  ) {
    return issue(
      "ambiguous",
      "A legacy CI workflow is custom or unavailable.",
      "Review deno.yaml and bump-deps.yaml manually before enabling GitHub CI.",
    );
  }
  if (legacy.some((item) => item.result === "matches")) {
    return issue(
      "drifted",
      "Exact git-hj-init workflows need migration.",
      "Select --github-ci to replace the legacy workflows while retaining required check names.",
    );
  }
  const artifacts = await inspectGithubCiArtifacts(context);
  if (artifacts.every((item) => item.result === "absent")) {
    return state("disabled", "Generated GitHub CI workflows are absent.");
  }
  const custom = artifacts.find((item) =>
    item.result === "unreadable" || item.result === "differs" &&
      (item.observation.kind !== "file" ||
        !item.observation.content.startsWith(githubCiMarker))
  );
  if (custom) return issue("ambiguous", "A GitHub workflow is custom.");
  if (!artifacts.every((item) => item.result === "matches")) {
    return issue(
      "drifted",
      "A generated GitHub workflow differs or is missing.",
    );
  }
  if (
    (await inspectLegacyReleaseWorkflow(context)).result === "matches" &&
    !artifacts.some((item) =>
      item.schema.kind === "file" &&
      item.schema.content.endsWith(legacyCiCheckCompatibility)
    )
  ) {
    return issue(
      "drifted",
      "Legacy release checks need migration.",
      "Select --github-ci to retain test and check during release migration.",
    );
  }
  const permission = await workflowPermission(context);
  if (permission === true) {
    return state("enabled", "Generated GitHub CI workflows are adopted.");
  }
  return issue(
    permission === false ? "drifted" : "ambiguous",
    permission === false
      ? "GitHub Actions cannot create and approve pull requests."
      : "Cannot read whether GitHub Actions can create and approve pull requests.",
    actionsPermissionResolution,
  );
}

function state(state: "enabled" | "disabled", observation: string) {
  return {
    state,
    evidence: [{
      code: `github-ci-${state}`,
      kind: "github-ci",
      subject: githubCiSubject(),
      observation,
    }],
  };
}
const actionsPermissionResolution =
  "Enable “Allow GitHub Actions to create and approve pull requests” under repository Settings > Actions > General.";

function issue(
  state: "drifted" | "ambiguous",
  observation: string,
  resolution = state === "drifted"
    ? "Use --repair to restore generated workflows."
    : "Resolve the custom workflow conflict manually.",
) {
  const item: DetectionIssue = {
    code: `github-ci-${state}`,
    kind: "github-ci",
    subject: githubCiSubject(),
    observation,
    resolution,
  };
  return {
    state,
    evidence: [{
      code: "github-ci-inspected",
      kind: "github-ci",
      subject: githubCiSubject(),
      observation,
    }],
    issues: [item],
  };
}

async function workflowPermission(
  context: DetectionContext,
): Promise<boolean | undefined> {
  const resource = await context.github?.resource(
    githubCiPermissionResource,
    githubCiPermissionName,
  );
  return typeof resource?.definition.value === "boolean"
    ? resource.definition.value
    : undefined;
}

/** Adds owned CI and dependency-update workflows without touching other workflows. */
export const githubCiFeature: Feature = {
  metadata: {
    id: githubCiFeatureId,
    name: "GitHub CI",
    summary: "Adds pull-request checks and dependency updates.",
  },
  dependencies: {
    requires: [
      {
        featureId: "github-repo",
        reason: "GitHub CI requires a GitHub repository.",
      },
      {
        featureId: "deno-fmt",
        reason: "GitHub CI runs the declared Deno checks.",
      },
    ],
  },
  capabilities: { provides: [], requires: [] },
  detect: detectGithubCi,
  checkEnable: checkEnableGithubCi,
  planEnable: planEnableGithubCi,
  checkDisable: checkDisableGithubCi,
  planDisable: planDisableGithubCi,
};
