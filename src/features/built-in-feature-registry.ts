/** @module Complete built-in feature and capability registry. */

import type { FeatureRegistry } from "./feature-registry.ts";
import { gitFeature } from "./git-feature.ts";
import { readmeStaticFeature } from "./readme-static-feature.ts";

/** Features available without repository-specific configuration. */
export const builtInFeatureRegistry: FeatureRegistry = {
  features: [gitFeature, readmeStaticFeature],
  capabilities: [{
    id: "readme",
    providerPolicy: "exclusive",
    defaultProvider: "readme-static",
  }],
};
