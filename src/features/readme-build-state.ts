/** @module Generated README paths and read-only state inspection. */

import { readmeBuildError } from "./readme-build-error.ts";
import { fileAccess } from "../repository/file-access.ts";
import { inspectLegacyReadme, legacyDefaultTask } from "./legacy-readme.ts";
import type { ArtifactObservation } from "../api/artifact-inspection.ts";
import type { DetectionContext } from "../api/repository-context.ts";
import { sameJson } from "../operations/local-plan-state.ts";
import { buildReadme } from "../readme/build-readme.ts";
import { inspectDenoConfig } from "./deno-config.ts";
import {
  denoTaskDefinitions,
  isObject,
  isReadmeTask,
  presentTaskIds,
} from "./deno-tasks.ts";
import { readmeStaticSchema } from "./readme-static-artifact.ts";

export const readmeBuildFeatureId = "readme-build";
export const readmeBuildSourcePath = "readme/README.md";
export const readmeBuildRootPath = "README.md";
export const readmeBuildDirectoryPath = "readme";

/** Complete generated README state from one repository snapshot. */
export async function inspectReadmeBuild(context: DetectionContext) {
  const [root, directory, config] = await Promise.all([
    context.files.observe(readmeBuildRootPath),
    context.files.observe(readmeBuildDirectoryPath),
    inspectDenoConfig(context),
  ]);
  const source: ArtifactObservation = directory.kind === "directory"
    ? await context.files.observe(readmeBuildSourcePath)
    : directory.kind === "absent"
    ? { kind: "absent" }
    : directory;
  const tasks = config.kind === "config" && isObject(config.value.tasks)
    ? config.value.tasks
    : undefined;
  const taskValue = tasks?.readme;
  const defaultValue = tasks?.default;
  const taskPresent = taskValue !== undefined;
  const exactTask = isReadmeTask(taskValue);
  const taskIds = tasks ? presentTaskIds(tasks) : [];
  const exactDefault = tasks !== undefined && sameJson(
    defaultValue,
    denoTaskDefinitions(taskIds, true).default,
  );
  const schema = await readmeStaticSchema(context);
  const initialSource = root.kind === "file"
    ? root.content
    : schema.kind === "file"
    ? schema.content
    : "";
  const managedSource =
    schema.kind === "file" && initialSource === schema.content
      ? "# {{package.name}}\n"
      : initialSource;
  const legacy = await inspectLegacyReadme(context, taskValue, source);
  const generated = legacy.kind === "recognized"
    ? { output: legacy.output }
    : await generatedOutput(context, source, initialSource);
  const output = generated.output;
  return {
    outputError: "error" in generated ? generated.error : undefined,
    root,
    source,
    legacy,
    directory,
    config,
    configKind: config.kind,
    configPath: config.kind === "config" ? config.path : undefined,
    taskValue,
    tasksValue: config.kind === "config" ? config.value.tasks : undefined,
    defaultValue,
    taskIds,
    taskPresent,
    exactTask,
    exactDefault,
    taskUsable: config.kind === "config" && tasks !== undefined &&
      (!taskPresent || isObject(taskValue) || legacy.kind === "recognized"),
    defaultUsable: config.kind === "config" && tasks !== undefined &&
      (defaultValue === undefined || isObject(defaultValue) ||
        legacy.kind === "recognized" && typeof defaultValue === "string" &&
          defaultValue.trim() === legacyDefaultTask),
    output,
    initialSource: managedSource,
    rootMatches: root.kind === "file" && output !== undefined &&
      root.content === output,
    rootMode: root.kind === "file" ? root.mode : undefined,
    generatedMarker: root.kind === "file" && !fileAccess(root).writable,
  };
}

async function generatedOutput(
  context: DetectionContext,
  source: ArtifactObservation,
  initialSource: string,
): Promise<{ output?: string; error?: string }> {
  if (source.kind === "absent") {
    return { output: initialSource };
  }
  if (source.kind !== "file") {
    return {};
  }
  try {
    return { output: await buildReadme(context.repositoryRoot) };
  } catch (error) {
    return { error: readmeBuildError(error, context.repositoryRoot) };
  }
}
