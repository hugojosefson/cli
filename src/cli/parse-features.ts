/** @module Pure parser for `hj repo features` arguments. */

import type {
  DefaultSelection,
  FeatureChangeRequest,
  RepairSelection,
} from "../api/feature-change.ts";
import type { FeatureRegistry } from "../features/feature-registry.ts";
import type { GlobalConfig } from "./global-config.ts";
import { validateDenoVersion } from "../features/workflow-deno.ts";
import { validScope } from "../package/metadata.ts";
import { validateWorkflowCli } from "../features/workflow-cli.ts";

export interface GithubSetupArguments {
  readonly githubOwner?: string;
  readonly githubName?: string;
  readonly defaultGithubVisibility?: "public" | "private";
}

interface FeatureRequestArguments extends GithubSetupArguments {
  readonly request: FeatureChangeRequest;
  readonly confirmation: boolean;
  readonly workflowCli?: string;
  readonly jsrScope?: string;
  readonly denoVersion?: string;
  readonly defaultDenoVersion?: string;
}

export type FeaturesArguments =
  | ({ readonly kind: "status" } & FeatureRequestArguments)
  | ({ readonly kind: "change" } & FeatureRequestArguments)
  | (GithubSetupArguments & {
    readonly kind: "interactive";
    readonly confirmation: boolean;
    readonly defaultDenoVersion?: string;
    readonly configuredDefaults?: readonly DefaultSelection[];
  });

export const featureDefaults = [
  { kind: "feature" as const, featureId: "git" },
  { kind: "capability" as const, capabilityId: "readme" },
];

/** Parses command arguments without reading or changing the target repository. */
export function parseFeatures(
  args: readonly string[],
  registry: FeatureRegistry,
  defaults: GlobalConfig = {},
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
  let githubOwner: string | undefined;
  let githubName: string | undefined;
  const githubDefaults = defaults["github-visibility"] === undefined
    ? {}
    : { defaultGithubVisibility: defaults["github-visibility"] };
  let workflowCli: string | undefined;
  let jsrScope: string | undefined;
  let denoVersion: string | undefined;
  for (const arg of args.slice(2)) {
    if (arg.startsWith("--github-owner=") || arg.startsWith("--github-name=")) {
      const owner = arg.startsWith("--github-owner=");
      const value = arg.slice(arg.indexOf("=") + 1);
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value) || value.length > 100) {
        throw new Error(
          "GitHub owner and name must be valid non-empty GitHub identifiers.",
        );
      }
      if (owner ? githubOwner !== undefined : githubName !== undefined) {
        throw new Error("duplicate GitHub repository option");
      }
      if (owner) githubOwner = value;
      else githubName = value;
      continue;
    }
    if (arg.startsWith("--deno-version=")) {
      if (denoVersion !== undefined) {
        throw new Error("duplicate --deno-version");
      }
      denoVersion = validateDenoVersion(arg.slice("--deno-version=".length));
      continue;
    }
    if (arg.startsWith("--jsr-scope=")) {
      if (jsrScope !== undefined) throw new Error("duplicate --jsr-scope");
      jsrScope = arg.slice("--jsr-scope=".length);
      if (!validScope(jsrScope)) {
        throw new Error(
          "--jsr-scope requires a valid JSR scope name without @.",
        );
      }
      continue;
    }
    if (arg.startsWith("--workflow-cli=")) {
      if (workflowCli !== undefined) {
        throw new Error("duplicate --workflow-cli");
      }
      workflowCli = validateWorkflowCli(arg.slice("--workflow-cli=".length));
      continue;
    }
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
  const configuredDefaults = defaults.features?.map((id) =>
    featureIds.has(id)
      ? { kind: "feature" as const, featureId: id }
      : { kind: "capability" as const, capabilityId: id }
  );
  if (interactive) {
    if (
      applyDefaults || repair || requested.size > 0 ||
      selectedPresets.size > 0 || workflowCli !== undefined ||
      jsrScope !== undefined || denoVersion !== undefined ||
      githubOwner !== undefined || githubName !== undefined
    ) {
      throw new Error(
        "`--interactive` cannot be combined with defaults, repair, or feature flags",
      );
    }
    return {
      kind: "interactive",
      confirmation,
      ...githubDefaults,
      ...(configuredDefaults === undefined ? {} : { configuredDefaults }),
      ...(defaults["deno-version"] === undefined
        ? {}
        : { defaultDenoVersion: defaults["deno-version"] }),
    };
  }
  const request = {
    changes: [...requested].map(([featureId, enabled]) => ({
      featureId,
      enabled,
    })),
    presets: [...selectedPresets],
    applyDefaults,
    defaults: configuredDefaults ?? featureDefaults,
    ...(repair ? { repair: repairSelection(requested) } : {}),
  };
  if (
    (workflowCli !== undefined || denoVersion !== undefined) &&
    !request.changes.some((change) =>
      change.enabled && [
        "github-ci",
        "github-release-publish-tag",
        "github-release-publish-jsr",
        "github-release-publish-github",
      ].includes(change.featureId)
    ) && !selectedPresets.has("jsr")
  ) {
    throw new Error(
      `${
        workflowCli !== undefined ? "--workflow-cli" : "--deno-version"
      } requires an explicit positive workflow feature or --jsr.`,
    );
  }
  if (
    jsrScope !== undefined &&
    (requested.get("jsr-package") === false ||
      (requested.get("jsr-package") !== true &&
        !selectedPresets.has("jsr")))
  ) {
    throw new Error("--jsr-scope requires --jsr-package or --jsr.");
  }
  if (
    (githubOwner !== undefined || githubName !== undefined) &&
    requested.size === 0 && selectedPresets.size === 0 && !applyDefaults
  ) {
    throw new Error(
      "GitHub repository options require a feature request such as --github-repo.",
    );
  }
  return requested.size === 0 && selectedPresets.size === 0 && !applyDefaults &&
      !repair
    ? { kind: "status", request, confirmation }
    : {
      kind: "change",
      ...githubDefaults,
      ...(githubOwner === undefined ? {} : { githubOwner }),
      ...(githubName === undefined ? {} : { githubName }),
      request,
      confirmation,
      ...(denoVersion === undefined ? {} : { denoVersion }),
      ...(defaults["deno-version"] === undefined
        ? {}
        : { defaultDenoVersion: defaults["deno-version"] }),
      ...(jsrScope === undefined ? {} : { jsrScope }),
      ...(workflowCli === undefined ? {} : { workflowCli }),
    };
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
