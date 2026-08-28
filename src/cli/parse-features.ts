/** @module Pure parser for `hj repo features` arguments. */

import type {
  FeatureChangeRequest,
  RepairSelection,
} from "../api/feature-change.ts";
import type { FeatureRegistry } from "../features/feature-registry.ts";

interface FeatureRequestArguments {
  readonly request: FeatureChangeRequest;
  readonly confirmation: boolean;
}

export type FeaturesArguments =
  | ({ readonly kind: "status" } & FeatureRequestArguments)
  | ({ readonly kind: "change" } & FeatureRequestArguments)
  | { readonly kind: "interactive"; readonly confirmation: boolean };

export const featureDefaults = [
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
  const presetIds = new Set((registry.presets ?? []).map((item) => item.id));
  const requested = new Map<string, boolean>();
  const selectedPresets = new Set<string>();
  let applyDefaults = false;
  let repair = false;
  let interactive = false;
  let confirmation = false;
  for (const arg of args.slice(2)) {
    if (arg === "--defaults") {
      if (applyDefaults) throw new Error("duplicate `--defaults`");
      applyDefaults = true;
      continue;
    }
    if (arg === "--repair") {
      if (repair) throw new Error("duplicate `--repair`");
      repair = true;
      continue;
    }
    if (arg === "--interactive" || arg === "-i") {
      if (interactive) throw new Error("duplicate `--interactive`");
      interactive = true;
      continue;
    }
    if (arg === "--yes") {
      if (confirmation) throw new Error("duplicate `--yes`");
      confirmation = true;
      continue;
    }
    if (!arg.startsWith("--")) throw new Error(`unexpected argument: ${arg}`);
    const disabled = arg.startsWith("--no-");
    const id = arg.slice(disabled ? 5 : 2);
    if (!id) throw new Error(`unknown flag: ${arg}`);
    if (presetIds.has(id)) {
      if (disabled) throw new Error(`presets cannot be disabled: ${arg}`);
      if (selectedPresets.has(id)) throw new Error(`duplicate preset: --${id}`);
      selectedPresets.add(id);
      continue;
    }
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
  if (interactive) {
    if (
      applyDefaults || repair || requested.size > 0 || selectedPresets.size > 0
    ) {
      throw new Error(
        "`--interactive` cannot be combined with defaults, repair, or feature flags",
      );
    }
    return { kind: "interactive", confirmation };
  }
  const request = {
    changes: [...requested].map(([featureId, enabled]) => ({
      featureId,
      enabled,
    })),
    presets: [...selectedPresets],
    applyDefaults,
    defaults: featureDefaults,
    ...(repair ? { repair: repairSelection(requested) } : {}),
  };
  return requested.size === 0 && selectedPresets.size === 0 && !applyDefaults &&
      !repair
    ? { kind: "status", request, confirmation }
    : { kind: "change", request, confirmation };
}

function repairSelection(
  requested: ReadonlyMap<string, boolean>,
): RepairSelection {
  const featureIds = [...requested].filter(([, enabled]) => enabled).map((
    [id],
  ) => id);
  if ([...requested.values()].some((enabled) => !enabled)) {
    throw new Error(
      "`--repair` cannot be combined with negative feature flags",
    );
  }
  return featureIds.length === 0
    ? { kind: "all-drifted" }
    : { kind: "features", featureIds };
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
