/** Apply saved choices before asking for the remaining interactive actions. */
import type {
  DefaultSelection,
  FeatureChangeRequest,
} from "../api/feature-change.ts";
import type { FeatureDetection } from "../api/feature-detection.ts";
import type { FeatureRegistry } from "../features/feature-registry.ts";
import {
  type FeatureAction,
  featureActions,
  selectedFeatureActionsToRequest,
} from "./feature-actions.ts";

export async function interactiveFeatureRequest(
  registry: FeatureRegistry,
  detections: ReadonlyMap<string, FeatureDetection>,
  defaults: readonly DefaultSelection[] | undefined,
  select: (
    actions: readonly FeatureAction[],
  ) => readonly string[] | Promise<readonly string[]>,
): Promise<FeatureChangeRequest> {
  if (defaults === undefined) {
    return selectedFeatureActionsToRequest(
      await select(featureActions(registry, detections)),
    );
  }
  const reserved = new Set<string>();
  for (const choice of defaults) {
    if (choice.kind === "feature") {
      reserved.add(choice.featureId);
      const provided = registry.features.find((feature) =>
        feature.metadata.id === choice.featureId
      )?.capabilities.provides ?? [];
      for (const capability of registry.capabilities) {
        if (
          capability.providerPolicy === "exclusive" &&
          provided.includes(capability.id)
        ) {
          for (const feature of registry.features) {
            if (feature.capabilities.provides.includes(capability.id)) {
              reserved.add(feature.metadata.id);
            }
          }
        }
      }
    } else {
      for (const feature of registry.features) {
        if (feature.capabilities.provides.includes(choice.capabilityId)) {
          reserved.add(feature.metadata.id);
        }
      }
    }
  }
  const available = featureActions(registry, detections).filter((action) =>
    !reserved.has(action.value.slice(action.value.indexOf(":") + 1))
  );
  const permitted = new Set(available.map((action) => action.value));
  const values = available.length ? await select(available) : [];
  if (values.some((value) => !permitted.has(value))) {
    throw new Error(
      "Interactive selection conflicts with configured defaults.",
    );
  }
  return {
    ...selectedFeatureActionsToRequest(values),
    applyDefaults: true,
    defaults,
  };
}
