/** @module Local feature overwrite without automatic Git commits. */
import type { ChangePlan } from "../api/change-plan.ts";
import type { OperationContext } from "../api/repository-context.ts";
import type { FeatureRegistry } from "../features/feature-registry.ts";
import { LocalGitReader } from "../repository/local-git-reader.ts";
import { LocalGithubClient } from "../repository/local-github-client.ts";
import { LocalGithubIdentityReader } from "../repository/local-github-identity-reader.ts";
import { applyLocalChangePlan } from "../operations/local-change-plan.ts";
import { runFinalProjectTask } from "./final-project-task.ts";
import type { FeatureOperationServices } from "./run-features.ts";
import type { FeaturesArguments } from "./parse-features.ts";
import { OverwriteFiles } from "./overwrite-files.ts";
import { overwriteArtifacts } from "./overwrite-artifacts.ts";
import { excludeOverwriteReadme } from "./overwrite-config.ts";
import {
  overwriteDetections,
  overwriteSelection,
} from "./overwrite-selection.ts";
import { planOverwriteFeatures } from "./plan-overwrite-features.ts";
import { overwriteNextSteps, overwriteWarning } from "./overwrite-output.ts";

export async function runOverwriteFeatures(
  root: URL,
  args: Extract<FeaturesArguments, { kind: "change" }>,
  registry: FeatureRegistry,
  services: FeatureOperationServices,
): Promise<string> {
  const files = new OverwriteFiles(root);
  const git = new LocalGitReader(root);
  const github = services.github ?? new LocalGithubClient(root);
  const githubIdentity = services.githubIdentity ??
    new LocalGithubIdentityReader(root);
  const detected = await overwriteDetections({
    repositoryRoot: root,
    files,
    git,
    github,
  }, registry);
  const changes = overwriteSelection(registry, detected, args.request);
  const base: OperationContext = {
    repositoryRoot: root,
    files,
    git,
    github,
    githubIdentity,
    detections: detected,
    requestedChanges: args.request.changes,
    resolvedChanges: changes,
    repair: undefined,
    options: {
      confirmation: args.confirmation,
      ...(args.denoVersion ? { denoVersion: args.denoVersion } : {}),
      ...(args.defaultDenoVersion
        ? { defaultDenoVersion: args.defaultDenoVersion }
        : {}),
      ...(args.workflowCli ? { workflowCli: args.workflowCli } : {}),
    },
  };
  const reconciled = await planOverwriteFeatures(
    base,
    files,
    args,
    registry,
    services,
  );
  const initializeGit = reconciled.some((plan) =>
    plan.changes.some((change) => change.kind === "git-init")
  );
  for (const plan of reconciled) {
    for (const change of plan.changes) {
      if (change.kind !== "git-init") await files.apply(change);
    }
  }
  if (
    changes.some((change) =>
      change.featureId === "readme-build" && change.enabled
    )
  ) {
    await excludeOverwriteReadme(files);
  }
  const localChanges = await files.changes();
  const paths = [
    ...new Set(
      localChanges.flatMap((change) => "path" in change ? [change.path] : []),
    ),
  ];
  const report = services.reportOverwrite ??
    ((message: string) => console.error(message));
  report(
    `${overwriteWarning}\n\nPlanned paths:\n${
      paths.map((path) => `  ${path}`).join("\n") || "  No local file changes."
    }`,
  );
  const plan: ChangePlan = {
    featureId: "overwrite",
    action: "enable",
    summary: "Apply local overwrite changes.",
    warnings: [],
    preconditions: [],
    validations: [],
    changes: [],
  };
  await files.verify();
  try {
    if (initializeGit) {
      await applyLocalChangePlan(root, {
        ...plan,
        changes: [{ kind: "git-init" }],
      });
    }
    for (const change of localChanges) {
      await applyLocalChangePlan(root, { ...plan, changes: [change] });
    }
    await (services.runFinalTask ?? runFinalProjectTask)(root, [{
      ...plan,
      changes: localChanges,
    }]);
    const finalContext = {
      repositoryRoot: root,
      files: new OverwriteFiles(root),
      git,
      github,
    };
    for (
      const change of changes.filter((item) =>
        overwriteArtifacts(item.featureId)
      )
    ) {
      const feature = registry.features.find((item) =>
        item.metadata.id === change.featureId
      )!;
      const state = await feature.detect(finalContext);
      const expected = change.enabled ? "enabled" : "disabled";
      if (state.state !== expected) {
        throw new Error(
          `Overwrite validation failed: ${change.featureId} is ${state.state}, expected ${expected}.`,
        );
      }
    }
    return `Local overwrite applied. No automatic Git commits.\n\n${overwriteNextSteps}`;
  } catch (error) {
    if (error instanceof Error) {
      error.message += `\n\n${overwriteNextSteps}`;
      throw error;
    }
    throw new Error(`${String(error)}\n\n${overwriteNextSteps}`, {
      cause: error,
    });
  }
}
