/** @module Pure interactive feature action selection. */

import type { FeatureChangeRequest } from "../api/feature-change.ts";
import type { FeatureDetection } from "../api/feature-detection.ts";
import type { FeatureRegistry } from "../features/feature-registry.ts";
import { featureDefaults } from "./parse-features.ts";

export interface FeatureAction {
  readonly value: string;
  readonly label: string;
}

/** Lists available actions in registry order from current detections. */
export function featureActions(
  registry: FeatureRegistry,
  detections: ReadonlyMap<string, FeatureDetection>,
): readonly FeatureAction[] {
  return registry.features.flatMap((feature) => {
    const id = feature.metadata.id;
    switch (detections.get(id)?.state) {
      case "disabled":
        return [action("enable", id)];
      case "enabled":
        return [action("disable", id)];
      case "drifted":
        return [action("repair", id), action("disable", id)];
      default:
        return [];
    }
  });
}

/** Converts prompt values into a feature request without performing I/O. */
export function selectedFeatureActionsToRequest(
  values: readonly string[],
): FeatureChangeRequest {
  const changes = new Map<string, boolean>();
  const repairs = new Set<string>();
  for (const value of values) {
    const [kind, featureId] = parseAction(value);
    if (kind === "repair") {
      repairs.add(featureId);
    } else {
      addChange(changes, featureId, kind === "enable");
    }
  }
  for (const featureId of repairs) {
    if (changes.get(featureId) === false) {
      throw new Error(
        `contradictory repair and disable selection for ${featureId}`,
      );
    }
  }
  return {
    changes: [...changes].map(([featureId, enabled]) => ({
      featureId,
      enabled,
    })),
    applyDefaults: false,
    defaults: featureDefaults,
    ...(repairs.size > 0
      ? { repair: { kind: "features" as const, featureIds: [...repairs] } }
      : {}),
  };
}

function action(
  kind: "enable" | "disable" | "repair",
  id: string,
): FeatureAction {
  return { value: `${kind}:${id}`, label: `${kind} ${id}` };
}

function parseAction(value: string): ["enable" | "disable" | "repair", string] {
  const separator = value.indexOf(":");
  const kind = value.slice(0, separator);
  const featureId = value.slice(separator + 1);
  if (
    separator < 1 || !featureId ||
    (kind !== "enable" && kind !== "disable" && kind !== "repair")
  ) throw new Error(`unknown interactive action: ${value}`);
  return [kind, featureId];
}

function addChange(
  changes: Map<string, boolean>,
  featureId: string,
  enabled: boolean,
): void {
  const previous = changes.get(featureId);
  if (previous !== undefined && previous !== enabled) {
    throw new Error(`contradictory selection for ${featureId}`);
  }
  changes.set(featureId, enabled);
}
