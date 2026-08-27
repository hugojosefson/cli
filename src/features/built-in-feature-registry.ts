/** @module Complete built-in feature and capability registry. */

import type { FeatureRegistry } from "./feature-registry.ts";
import { denoCliFeature } from "./deno-cli-feature.ts";
import { denoFmtFeature } from "./deno-fmt-feature.ts";
import {
  denoLintFeature,
  denoTestFeature,
  denoTypecheckFeature,
} from "./deno-task-features.ts";
import { denoLibFeature } from "./deno-lib-feature.ts";
import { denoServerFeature } from "./deno-server-feature.ts";
import { gitFeature } from "./git-feature.ts";
import { readmeStaticFeature } from "./readme-static-feature.ts";

/** Features available without repository-specific configuration. */
export const builtInFeatureRegistry: FeatureRegistry = {
  features: [
    denoCliFeature,
    denoFmtFeature,
    denoLintFeature,
    denoTypecheckFeature,
    denoTestFeature,
    denoLibFeature,
    denoServerFeature,
    gitFeature,
    readmeStaticFeature,
  ],
  capabilities: [{ id: "deno-export", providerPolicy: "multiple" }, {
    id: "readme",
    providerPolicy: "exclusive",
    defaultProvider: "readme-static",
  }],
};
