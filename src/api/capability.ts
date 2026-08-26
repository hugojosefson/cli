/** @module Capability declarations and provider selection policy. */

import type { FeatureId } from "./feature.ts";

/** A stable identifier for a behavior that one or more features can supply. */
export type CapabilityId = string;

/** A capability required before a feature can be enabled. */
export interface RequiredCapability {
  readonly capabilityId: CapabilityId;
  readonly reason: string;
}

/** Capabilities a feature supplies and capabilities it requires. */
export interface FeatureCapabilities {
  readonly provides: readonly CapabilityId[];
  readonly requires: readonly RequiredCapability[];
}

/** Limits whether a capability may have more than one enabled provider. */
export type CapabilityProviderPolicy = "exclusive" | "multiple";

/** Selection rules for one capability in the registry. */
export interface CapabilityDefinition {
  readonly id: CapabilityId;
  readonly providerPolicy: CapabilityProviderPolicy;
  /** Provider selected when a required capability has no enabled provider. */
  readonly defaultProvider?: FeatureId;
}

/** Registry used by the resolver to validate and select capability providers. */
export interface CapabilityRegistryDefinition {
  readonly capabilities: readonly CapabilityDefinition[];
}
