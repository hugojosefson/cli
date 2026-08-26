/** @module Runtime feature and capability declarations. */

import type { CapabilityDefinition } from "../api/capability.ts";
import type { Feature } from "../api/feature.ts";

/** The declarations used to resolve one repository's feature changes. */
export interface FeatureRegistry {
  readonly features: readonly Feature[];
  readonly capabilities: readonly CapabilityDefinition[];
}
