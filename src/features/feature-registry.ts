/** @module Runtime feature and capability declarations. */

import type { CapabilityDefinition } from "../api/capability.ts";
import type { Feature, FeatureId } from "../api/feature.ts";

/** A named collection of desired feature states. */
export interface FeaturePreset<Id extends FeatureId = FeatureId> {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly changes: readonly {
    readonly featureId: Id;
    readonly enabled: boolean;
  }[];
}

/** The declarations used to resolve one repository's feature changes. */
export interface FeatureRegistry<Id extends FeatureId = FeatureId> {
  readonly features: readonly Feature[];
  readonly capabilities: readonly CapabilityDefinition[];
  /** Optional named collections of feature-state changes. */
  readonly presets?: readonly FeaturePreset<Id>[];
}
