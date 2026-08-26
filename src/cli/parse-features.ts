/** @module Pure parser for `hj repo features` arguments. */

import type { FeatureChangeRequest } from "../api/feature-change.ts";
import type { FeatureRegistry } from "../features/feature-registry.ts";

export type FeaturesArguments =
  | { readonly kind: "status"; readonly request: FeatureChangeRequest }
  | { readonly kind: "change"; readonly request: FeatureChangeRequest };

const defaults = [
  { kind: "feature" as const, featureId: "git" },
  { kind: "capability" as const, capabilityId: "readme" },
];

/** Parses command arguments without reading or changing the target repository. */
export function parseFeatures(
  args: readonly string[],
  registry: FeatureRegistry,
): FeaturesArguments {
  if (args[0] !== "repo" || args[1] !== "features") {
    throw new Error("expected `hj repo features`");
  }
  const featureIds = new Set(registry.features.map((item) => item.metadata.id));
  const capabilities = new Map(
    registry.capabilities.map((item) => [item.id, item]),
  );
  const requested = new Map<string, boolean>();
  let applyDefaults = false;
  for (const arg of args.slice(2)) {
    if (arg === "--defaults") {
      if (applyDefaults) throw new Error("duplicate `--defaults`");
      applyDefaults = true;
      continue;
    }
    if (arg === "--repair" || arg.startsWith("--repair=")) {
      throw new Error("`--repair` is not implemented");
    }
    if (arg === "--interactive" || arg === "-i") {
      throw new Error("interactive mode is not implemented");
    }
    if (!arg.startsWith("--")) throw new Error(`unexpected argument: ${arg}`);
    const disabled = arg.startsWith("--no-");
    const id = arg.slice(disabled ? 5 : 2);
    if (!id) throw new Error(`unknown flag: ${arg}`);
    if (featureIds.has(id)) {
      addRequest(requested, id, !disabled);
      continue;
    }
    const capability = capabilities.get(id);
    if (!capability) throw new Error(`unknown flag: ${arg}`);
    const providers = registry.features.filter((item) =>
      item.capabilities.provides.includes(id)
    ).map((item) => item.metadata.id);
    if (disabled) {
      for (const provider of providers) addRequest(requested, provider, false);
    } else if (capability.defaultProvider) {
      addRequest(requested, capability.defaultProvider, true);
    } else throw new Error(`capability has no default provider: ${id}`);
  }
  const request = {
    changes: [...requested].map(([featureId, enabled]) => ({
      featureId,
      enabled,
    })),
    applyDefaults,
    defaults,
  };
  return requested.size === 0 && !applyDefaults
    ? { kind: "status", request }
    : { kind: "change", request };
}

function addRequest(
  requested: Map<string, boolean>,
  id: string,
  enabled: boolean,
): void {
  const previous = requested.get(id);
  if (previous !== undefined && previous !== enabled) {
    throw new Error(`contradictory request for --${id}`);
  }
  requested.set(id, enabled);
}
