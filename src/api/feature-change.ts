/** @module Requested and resolved feature change contracts. */

import type { CapabilityId } from "./capability.ts";
import type { FeatureId } from "./feature.ts";

/** A feature or capability selected by `--defaults`. */
export type DefaultSelection =
  | { readonly kind: "feature"; readonly featureId: FeatureId }
  | { readonly kind: "capability"; readonly capabilityId: CapabilityId };

/** A feature state explicitly requested by the caller. */
export interface RequestedFeatureChange {
  readonly featureId: FeatureId;
  readonly enabled: boolean;
}

/** Why dependency resolution selected a feature state. */
export type ResolvedChangeReason =
  | { readonly kind: "explicit-request" }
  | { readonly kind: "repair" }
  | {
    readonly kind: "direct-feature-dependency";
    readonly requiredBy: FeatureId;
    readonly reason: string;
  }
  | { readonly kind: "defaults" }
  | {
    readonly kind: "capability-default-provider";
    readonly capabilityId: CapabilityId;
    readonly requiredBy: FeatureId;
  }
  | {
    readonly kind: "exclusive-provider-replacement";
    readonly capabilityId: CapabilityId;
    readonly replacedBy: FeatureId;
  };

/** A requested state after resolving dependencies and capability providers. */
export interface ResolvedFeatureChange {
  readonly featureId: FeatureId;
  readonly enabled: boolean;
  readonly reason: ResolvedChangeReason;
}

/** Features whose detected artifacts should be repaired. */
export type RepairSelection =
  | { readonly kind: "all-drifted" }
  | { readonly kind: "features"; readonly featureIds: readonly FeatureId[] };

/** Feature changes explicitly requested by the caller. */
export interface FeatureChangeRequest {
  readonly changes: readonly RequestedFeatureChange[];
  /** True only when the caller explicitly passed `--defaults`. */
  readonly applyDefaults: boolean;
  /** Globally configured selections, or the built-in fallback selections. */
  readonly defaults: readonly DefaultSelection[];
  /** Artifact repair intent; state resolution still treats drifted as present. */
  readonly repair?: RepairSelection;
}
