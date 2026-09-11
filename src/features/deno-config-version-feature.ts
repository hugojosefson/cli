/** @module Exact Deno-config SemVer version provider. */

import type { Feature } from "../api/feature.ts";
import type { OperationCheck } from "../api/feature-operation.ts";
import { inspectDenoConfig } from "./deno-config.ts";
import { parseSemver } from "../release/semver.ts";

type VersionState =
  | { readonly kind: "enabled" }
  | { readonly kind: "disabled" }
  | { readonly kind: "ambiguous"; readonly observation: string };

const unavailable = (message: string): OperationCheck => ({
  result: "blocked",
  blockers: [{
    code: "deno-config-version-invalid",
    message,
    subjects: [],
    resolution:
      "Provide exactly one valid Deno config with an exact SemVer version.",
  }],
  warnings: [],
});

/** Supplies the release version only when the checked config is exact and valid. */
export const denoConfigVersionFeature: Feature = {
  metadata: {
    id: "deno-config-version",
    name: "Deno config version",
    summary: "Uses an exact SemVer version in the Deno config.",
  },
  dependencies: { requires: [] },
  capabilities: { provides: ["version-provider"], requires: [] },
  detect: async (context) => {
    const state = await inspectVersion(context);
    if (state.kind !== "ambiguous") {
      return { state: state.kind, evidence: [] };
    }
    return {
      state: "ambiguous",
      evidence: [],
      issues: [{
        code: "deno-config-version-ambiguous",
        kind: "deno-config-version",
        subject: {
          kind: "repository-path",
          identifier: "deno.json|deno.jsonc",
        },
        observation: state.observation,
        resolution:
          "Provide exactly one Deno config with an exact SemVer version.",
      }],
    };
  },
  checkEnable: async (context) => {
    const state = await inspectVersion(context);
    return state.kind === "enabled"
      ? {
        result: "no-op",
        reason: "Deno config supplies an exact SemVer version.",
        warnings: [],
      }
      : unavailable(
        state.kind === "ambiguous"
          ? state.observation
          : "Deno config version is absent.",
      );
  },
  planEnable: () =>
    Promise.reject(
      new Error("Deno config version cannot be created automatically."),
    ),
  checkDisable: async (context) => {
    const state = await inspectVersion(context);
    return state.kind === "disabled"
      ? {
        result: "no-op",
        reason: "Deno config does not supply a release version.",
        warnings: [],
      }
      : unavailable(
        state.kind === "ambiguous"
          ? state.observation
          : "Deno config version cannot be removed automatically.",
      );
  },
  planDisable: () =>
    Promise.reject(
      new Error("Deno config version cannot be removed automatically."),
    ),
};

async function inspectVersion(
  context: Parameters<typeof inspectDenoConfig>[0],
): Promise<VersionState> {
  const config = await inspectDenoConfig(context);
  if (config.kind === "absent") return { kind: "disabled" };
  if (config.kind === "ambiguous") {
    return { kind: "ambiguous", observation: config.observation };
  }
  if (config.value.version === undefined) return { kind: "disabled" };
  if (
    typeof config.value.version !== "string" ||
    !parseSemver(config.value.version)
  ) {
    return {
      kind: "ambiguous",
      observation: "Deno config version is not exact SemVer.",
    };
  }
  return { kind: "enabled" };
}
