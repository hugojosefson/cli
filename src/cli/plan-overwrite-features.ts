/** @module Feature plans against bounded virtual overwrite artifacts. */
import { clearOverwriteLicenseSections } from "./overwrite-license-readme.ts";
import type { ChangePlan } from "../api/change-plan.ts";
import type { OperationContext } from "../api/repository-context.ts";
import type { FeatureRegistry } from "../features/feature-registry.ts";
import type { FeatureOperationServices } from "./run-features.ts";
import type { FeaturesArguments } from "./parse-features.ts";
import type { OverwriteFiles } from "./overwrite-files.ts";
import { overwriteArtifacts } from "./overwrite-artifacts.ts";
import { prepareOverwriteConfig } from "./overwrite-config.ts";
import { overwriteDetections } from "./overwrite-selection.ts";
import { licenseCatalog } from "../features/license-catalog.ts";
import { AuthenticatedJsrScopeReader } from "../repository/jsr-scope-reader.ts";
import { resolveJsrScope } from "./jsr-scope.ts";
import { resolveLicenseAttribution } from "./license-attribution.ts";
import { reconcileFeaturePlans } from "./reconcile-feature-plans.ts";

export async function planOverwriteFeatures(
  base: OperationContext,
  files: OverwriteFiles,
  args: Extract<FeaturesArguments, { kind: "change" }>,
  registry: FeatureRegistry,
  services: FeatureOperationServices,
): Promise<readonly ChangePlan[]> {
  const changes = base.resolvedChanges;
  const reset: string[] = [];
  for (const change of changes) {
    const feature = registry.features.find((item) =>
      item.metadata.id === change.featureId
    )!;
    const owned = overwriteArtifacts(change.featureId);
    if (!owned || change.featureId === "git") continue;
    const check =
      await (change.enabled ? feature.checkEnable : feature.checkDisable)(base);
    if (!change.enabled || check.result === "blocked") {
      reset.push(change.featureId);
      for (const path of owned.files) {
        await files.clearParents(path);
        await files.remove(path);
      }
    }
  }
  if (reset.some((id) => id.startsWith("license-"))) {
    await clearOverwriteLicenseSections(files);
  }
  if (reset.includes("readme-build")) {
    await files.write(
      ".hj/readme.json",
      JSON.stringify({ version: 1, files: {} }) + "\n",
    );
  }
  const configOwners = reset.filter((id) =>
    overwriteArtifacts(id)?.config !== undefined
  );
  if (configOwners.length) {
    await prepareOverwriteConfig(
      files,
      configOwners,
      configOwners.flatMap((id) => overwriteArtifacts(id)!.config!),
    );
  }
  const detections = await overwriteDetections(base, registry);
  const attribution = changes.some((change) =>
      change.enabled &&
      detections.get(change.featureId)?.state === "disabled" &&
      licenseCatalog.find((license) => license.id === change.featureId)
        ?.definition.placeholders.length
    )
    ? await resolveLicenseAttribution(base, services.promptAttribution)
    : {};
  const scope =
    changes.some((change) =>
        change.enabled && change.featureId === "jsr-package"
      )
      ? await resolveJsrScope(
        base,
        services.jsrScopes ?? new AuthenticatedJsrScopeReader(),
        args.jsrScope,
        args.confirmation ? undefined : services.promptJsrScope,
      )
      : {};
  const context = {
    ...base,
    repair: { kind: "features" as const, featureIds: reset },
    detections,
    options: { ...base.options, ...attribution, ...scope },
  };
  const plans: ChangePlan[] = [];
  for (const change of changes) {
    if (!change.enabled && reset.includes(change.featureId)) continue;
    const feature = registry.features.find((item) =>
      item.metadata.id === change.featureId
    )!;
    const check =
      await (change.enabled ? feature.checkEnable : feature.checkDisable)(
        context,
      );
    if (check.result === "blocked") {
      throw new Error(
        `${change.featureId}: ${
          check.blockers.map((item) => `${item.message} ${item.resolution}`)
            .join(
              "\n",
            )
        }`,
      );
    }
    if (check.result === "allowed") {
      plans.push(
        await (change.enabled ? feature.planEnable : feature.planDisable)(
          context,
          check,
        ),
      );
    }
  }
  return await reconcileFeaturePlans(context, plans, registry);
}
