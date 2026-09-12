/** @module Compose feature-owned README guides against the final feature plans. */
import { fromFileUrl } from "@std/path";
import {
  packageImports,
  rewritePackageImport,
} from "../readme/package-import.ts";
import type { ChangePlan } from "../api/change-plan.ts";
import type { OperationContext } from "../api/repository-context.ts";
import { readPackageMetadata, validJsrName } from "../package/metadata.ts";
import { buildReadmeText } from "../readme/build-readme.ts";
import { reconcileBlocks } from "../readme/contribution-blocks.ts";
import {
  guideContributions,
  libraryExample,
} from "../readme/guide-contributions.ts";
import {
  exampleExport,
  examplePath,
  guideStatePath,
  installPath,
  manageGuideFile,
  readGuideState,
} from "../readme/guide-files.ts";
import { PlannedReadmeFiles } from "../readme/planned-readme-files.ts";
import { inspectDenoConfig } from "./deno-config.ts";
import { isObject } from "./deno-tasks.ts";

/** Shared by static and built README providers; never writes while planning. */
export async function reconcileReadmePlans(
  context: OperationContext,
  plans: readonly ChangePlan[],
): Promise<readonly ChangePlan[]> {
  const active = (id: string) =>
    context.resolvedChanges.find((change) => change.featureId === id)
      ?.enabled ??
      ["enabled", "drifted"].includes(context.detections.get(id)?.state ?? "");
  const build = active("readme-build");
  const files = new PlannedReadmeFiles(
    context.files,
    plans.flatMap((plan) => plan.changes),
  );
  const root = await files.observe("README.md");
  if (!build && !(root.kind === "file" && (root.mode & 0o200) !== 0)) {
    return plans;
  }
  const projected = {
    ...context,
    files,
  };
  const config = await inspectDenoConfig(projected);
  const metadata = await readPackageMetadata(projected);
  const jsr = active("jsr-package") && validJsrName(metadata.name);
  const exports = isObject(metadata.config.exports)
    ? metadata.config.exports
    : {};
  const cli = active("deno-cli") && typeof exports["./cli"] === "string";
  const target = typeof exports["."] === "string" ? exports["."] : undefined;
  const lib = active("deno-lib") && target?.startsWith("./") &&
    target !== exports["./cli"];
  const sourcePath = build ? "readme/README.md" : "README.md";
  const customSource = await reconcileBlocks(
    await files.read(sourcePath) ?? "",
    [],
  );
  const retainedInclude = (path: string) =>
    build &&
    customSource.includes(`@@include(./${path.slice("readme/".length)})`);
  const state = await readGuideState(files);
  const initialState = JSON.stringify(state);
  const initialChangeCount = files.changes.length;
  const install = await manageGuideFile(
    files,
    state,
    installPath,
    jsr
      ? `#!/usr/bin/env bash\ndeno add jsr:${metadata.name}\n`
      : retainedInclude(installPath)
      ? await files.read(installPath)
      : undefined,
  );
  // Do not invent calls into a customized API. Only the generated placeholder
  // or an existing runnable public example supplies a usage guide.
  const library = lib && target ? await files.read(target.slice(2)) : undefined;
  const canGenerate = library === "export function placeholder(): void {}\n";
  const example = await manageGuideFile(
    files,
    state,
    examplePath,
    jsr && lib && canGenerate
      ? libraryExample(target!)
      : retainedInclude(examplePath)
      ? await files.read(examplePath)
      : undefined,
  );
  const publicExample = jsr && lib && example !== undefined &&
    (exports["./example-usage"] === undefined ||
      exports["./example-usage"] === exampleExport);
  if (config.kind === "config") {
    if (publicExample && exports["./example-usage"] === undefined) {
      files.changes.push({
        kind: "set-json",
        path: config.path,
        jsonPath: ["exports", "./example-usage"],
        value: exampleExport,
        expected: undefined,
      });
      state.exampleExport = true;
    } else if (
      !publicExample && state.exampleExport &&
      example === undefined &&
      exports["./example-usage"] === exampleExport
    ) {
      files.changes.push({
        kind: "remove-json",
        path: config.path,
        jsonPath: ["exports", "./example-usage"],
        expected: exampleExport,
      });
      delete state.exampleExport;
    }
    const publish = metadata.config.publish;
    if (
      publicExample && isObject(publish) && Array.isArray(publish.include) &&
      !publish.include.includes("readme") &&
      !publish.include.includes(exampleExport) &&
      !publish.include.includes(examplePath)
    ) {
      files.changes.push({
        kind: "set-json",
        path: config.path,
        jsonPath: ["publish", "include"],
        value: [...publish.include, examplePath],
        expected: publish.include,
      });
    }
  }
  if (JSON.stringify(state) !== initialState) {
    await files.write(guideStatePath, JSON.stringify(state, null, 2) + "\n");
  }
  const fileChanges = files.changes.slice(initialChangeCount);
  const github = active("github-ci")
    ? await context.github?.repository()
    : undefined;
  const ciChange = context.resolvedChanges.find((change) =>
    change.featureId === "github-ci"
  );
  const ciState = context.detections.get("github-ci")?.state;
  const preserveCiBadge = ciChange?.enabled !== false &&
    (ciState === "ambiguous" || ciState === undefined ||
      active("github-ci") && !github);
  const cliSource = cli
    ? await files.read(String(exports["./cli"]).slice(2))
    : undefined;
  const permissions = cliSource?.match(/DENO_RUN_ARGS="([^"]*)"/)?.[1] ?? "";
  const cliPermissions =
    /^(?:--allow-[a-z]+(?:=[a-zA-Z0-9.:,/_-]+)?\s*)*$/.test(permissions) &&
      permissions
      ? permissions.trim() + " "
      : "";
  const imports = await packageImports(
    fromFileUrl(context.repositoryRoot),
    () => Promise.resolve(metadata),
  );
  const staticExample = example?.split("\n").map((line) =>
    rewritePackageImport(
      line,
      fromFileUrl(new URL(examplePath, context.repositoryRoot)),
      imports,
    )
  ).join("\n");
  const contributions = guideContributions({
    metadata,
    build,
    jsr,
    cli,
    deno: [
      ...context.detections.keys(),
      ...context.resolvedChanges.map((change) => change.featureId),
    ].some((id) => id.startsWith("deno-") && active(id)),
    install: jsr ? install : undefined,
    example: publicExample ? staticExample : undefined,
    github,
    cliPermissions,
  });
  const provider = build ? "readme-build" : "readme-static";
  const owners = [
    ...new Set([
      ...plans.map((plan) => plan.featureId),
      provider,
      "jsr-package",
      "deno-cli",
      "deno-lib",
      "github-ci",
    ]),
  ].filter((id) =>
    [provider, "jsr-package", "deno-cli", "deno-lib", "github-ci"].includes(id)
  );
  const appended: ChangePlan[] = [];
  // File/export ownership belongs to JSR publication. README blocks stay with
  // the feature named in their marker so per-feature commits remain possible.
  if (fileChanges.length) {
    appended.push(contributionPlan("jsr-package", fileChanges));
  }
  for (const owner of owners) {
    if (owner === "github-ci" && preserveCiBadge) continue;
    const before = files.changes.length;
    const current = await files.read(sourcePath);
    if (current === undefined) continue;
    const key = owner === provider ? "readme" : owner;
    const desired = contributions.filter((item) =>
      item.id.startsWith(key + ":")
    );
    const source = await reconcileBlocks(current, desired, key);
    await files.write(sourcePath, source);
    if (build) {
      const output = await buildReadmeText(
        context.repositoryRoot,
        source,
        sourcePath,
        {
          metadata,
          // Removed includes remain available for intermediate owner snapshots.
          // The final source omits them unless a custom block retains the file.
          readFile: async (path) =>
            await files.read(path) ?? await context.files.readText(path),
        },
      );
      await files.write("README.md", output, 0o444);
    }
    const changes = files.changes.slice(before);
    if (changes.length) appended.push(contributionPlan(owner, changes));
  }
  if (!appended.length) return plans;
  const guard = {
    ...contributionPlan(provider, []),
    preconditions: files.preconditions,
  };
  return [guard, ...plans, ...appended];
}
function contributionPlan(
  featureId: string,
  changes: ChangePlan["changes"],
): ChangePlan {
  return {
    featureId,
    action: "enable",
    summary: `Update ${featureId} README contributions.`,
    preconditions: [],
    warnings: [],
    changes,
    validations: [],
  };
}
