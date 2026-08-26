/** @module Result types for pure feature-change resolution. */

import type { CapabilityId } from "../api/capability.ts";
import type { ResolvedFeatureChange } from "../api/feature-change.ts";
import type { FeatureId } from "../api/feature.ts";
import type { FeatureRegistryIssue } from "./validate-feature-registry.ts";

/** A request that cannot safely produce a feature plan. */
export interface FeatureResolutionIssue {
  readonly code:
    | "invalid-registry"
    | "unknown-requested-feature"
    | "unknown-default-feature"
    | "unknown-default-capability"
    | "contradictory-feature-request"
    | "ambiguous-feature"
    | "explicitly-disabled-dependency"
    | "missing-capability-provider"
    | "conflicting-exclusive-providers"
    | "direct-dependent-remains-enabled"
    | "capability-consumer-remains-enabled";
  readonly featureId?: FeatureId;
  readonly capabilityId?: CapabilityId;
  readonly relatedId?: string;
  readonly registryIssue?: FeatureRegistryIssue;
}

/** The resolved mutations and blockers for one feature-change request. */
export interface FeatureChangeResolution {
  readonly changes: readonly ResolvedFeatureChange[];
  readonly issues: readonly FeatureResolutionIssue[];
}
