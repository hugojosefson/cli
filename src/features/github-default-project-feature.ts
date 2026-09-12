/** @module A linked default project and a place for every repository issue. */
import type { Feature } from "../api/feature.ts";
import type { ChangePlan } from "../api/change-plan.ts";
import type {
  AllowedOperation,
  OperationCheck,
} from "../api/feature-operation.ts";
import type {
  DetectionContext,
  OperationContext,
} from "../api/repository-context.ts";
import {
  defaultProjectName,
  defaultProjectResource,
  projectAccessResolution,
} from "../repository/github-default-project.ts";

const id = "github-default-project";
const subject = { kind: "github-project", identifier: "default" };
const read = (context: DetectionContext) =>
  context.github?.resource(defaultProjectResource, defaultProjectName);

async function detect(context: DetectionContext) {
  if (!await context.github?.repository()) {
    return state("disabled", "A linked GitHub repository is required.");
  }
  const resource = await read(context);
  if (!resource) {
    return state(
      "ambiguous",
      "Cannot read GitHub projects.",
      projectAccessResolution,
    );
  }
  const value = resource.definition;
  if (value.candidates as number > 1 || value.fieldConflict || value.closed) {
    return state(
      "ambiguous",
      "The default project is ambiguous, closed, or has conflicting fields.",
      "Keep one open repository-named or linked project with single-select Status and Priority fields.",
    );
  }
  if (!value.projectId || !value.linked) {
    return state("disabled", "The default GitHub project is not linked.");
  }
  if (
    !value.hasStatus || !value.hasPriority || !value.hasBoard ||
    !value.hasWork || !value.areaReady || !value.areaVisible ||
    !value.statusOrderReady || value.missingIssues !== 0
  ) {
    const details = Array.isArray(value.repairDetails)
      ? value.repairDetails.filter((detail) => typeof detail === "string")
      : [];
    return state(
      "drifted",
      details.length
        ? `Repair would:\n${details.join("\n")}`
        : "The default project needs its views, Area values, status order, fields, or missing issues.",
      "Run --github-default-project --yes to add missing configuration, issues, Area values, and labels.",
    );
  }
  return state(
    "enabled",
    `All repository issues use ${value.boardUrl ?? value.url}.`,
  );
}

function state(
  state: "enabled" | "disabled" | "drifted" | "ambiguous",
  observation: string,
  resolution?: string,
) {
  const evidence = { code: `${id}-${state}`, kind: id, subject, observation };
  return {
    state,
    evidence: [evidence],
    issues: resolution ? [{ ...evidence, resolution }] : [],
  };
}

function check(enabled: boolean) {
  return async (context: OperationContext): Promise<OperationCheck> => {
    const detection = await detect(context);
    const resource = await read(context);
    if (!resource || detection.state === "ambiguous") {
      return {
        result: "blocked",
        blockers: [{
          code: "github-default-project-unavailable",
          message: detection.evidence[0].observation,
          subjects: [subject],
          resolution: detection.issues?.[0].resolution ??
            projectAccessResolution,
        }],
        warnings: [],
      };
    }
    if (
      enabled && detection.state === "enabled" ||
      !enabled && !resource.definition.linked
    ) {
      return {
        result: "no-op",
        reason: detection.evidence[0].observation,
        warnings: [],
      };
    }
    return {
      result: "allowed",
      warnings: [{
        code: "github-default-project-mutation",
        message: enabled
          ? "Create or reuse the default project, link it, add all repository issues, and synchronize Area values and area:* labels by adding missing values."
          : "Unlink the default project. Its fields and items remain in GitHub.",
        subjects: [subject],
        requiresConfirmation: true,
      }],
      preconditions: [{
        kind: "github-resource-state",
        resource: defaultProjectResource,
        name: defaultProjectName,
        stateDigest: resource.stateDigest,
      }],
    };
  };
}

function plan(enabled: boolean) {
  return (
    _context: OperationContext,
    allowed: AllowedOperation,
  ): Promise<ChangePlan> =>
    Promise.resolve({
      featureId: id,
      action: enabled ? "enable" : "disable",
      summary: enabled
        ? "Configure the default GitHub project and its issues."
        : "Unlink the default GitHub project.",
      warnings: allowed.warnings,
      preconditions: allowed.preconditions,
      changes: [{
        kind: "upsert-github-resource",
        resource: defaultProjectResource,
        name: defaultProjectName,
        definition: { enabled },
        expectedStateDigest: allowed.preconditions.find((item) =>
          item.kind === "github-resource-state"
        )!.stateDigest,
      }],
      validations: [{
        kind: "feature-redetection",
        featureId: id,
        expected: enabled ? "enabled" : "disabled",
      }],
    });
}

export const githubDefaultProjectFeature: Feature = {
  metadata: {
    id,
    name: "Default GitHub project",
    summary: "Links a repository project and adds all repository issues.",
  },
  dependencies: {
    requires: [{
      featureId: "github-projects",
      reason: "The default project uses GitHub Projects.",
    }],
  },
  capabilities: { provides: [], requires: [] },
  detect,
  checkEnable: check(true),
  planEnable: plan(true),
  checkDisable: check(false),
  planDisable: plan(false),
};
