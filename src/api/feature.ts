/** @module Feature identity, metadata, dependencies, and lifecycle contracts. */

import type {
  CheckDisable,
  CheckEnable,
  Detect,
  PlanDisable,
  PlanEnable,
} from "./feature-operation.ts";
import type { FeatureCapabilities } from "./capability.ts";

/** A stable feature identifier. Plain strings keep declarations usable in config. */
export type FeatureId = string;

/** Human-facing identity and description for a feature. */
export interface FeatureMetadata {
  readonly id: FeatureId;
  readonly name: string;
  readonly summary: string;
}

/** A feature that must be enabled, and why it is required. */
export interface RequiredFeatureDependency {
  readonly featureId: FeatureId;
  readonly reason: string;
}

/** Features required before this feature can be enabled. */
export interface FeatureDependencies {
  readonly requires: readonly RequiredFeatureDependency[];
}

/** Feature combinations which one operation cannot select. */
export type FeatureConflicts = {
  readonly featureIds: readonly FeatureId[];
  /** Features which cannot be disabled in the same operation. */
  readonly disableWith?: readonly FeatureId[];
};

/** A command which must succeed before a release candidate is accepted. */
export type ReleaseContribution = {
  readonly command: string;
  readonly args: readonly string[];
};

/** A feature's identity, dependencies, capabilities, and lifecycle operations. */
export interface Feature {
  readonly metadata: FeatureMetadata;
  readonly dependencies: FeatureDependencies;
  readonly conflicts?: FeatureConflicts;
  readonly capabilities: FeatureCapabilities;
  /** Optional pre-tag validations contributed by an exact active publisher. */
  readonly releaseContributions?: readonly ReleaseContribution[];
  readonly detect: Detect;
  readonly checkEnable: CheckEnable;
  readonly planEnable: PlanEnable;
  readonly checkDisable: CheckDisable;
  readonly planDisable: PlanDisable;
}
