/** @module Feature detection, checks, and planning contracts. */

import type { ChangePlan, Precondition } from "./change-plan.ts";
import type {
  DetectionSubject,
  FeatureDetection,
} from "./feature-detection.ts";
import type {
  DetectionContext,
  OperationContext,
} from "./repository-context.ts";

/** A non-fatal concern reported before planning an operation. */
export interface OperationWarning {
  readonly code: string;
  readonly message: string;
  readonly subjects: readonly DetectionSubject[];
  readonly resolution?: string;
  /** Acknowledgement is required before applying this plan. `--yes` accepts it. */
  readonly requiresConfirmation?: boolean;
}

/** A reason an operation cannot be planned. */
export interface OperationBlocker {
  readonly code: string;
  readonly message: string;
  readonly subjects: readonly DetectionSubject[];
  readonly resolution: string;
}

/** Proof from a check that lets a planner create a plan. */
export interface AllowedOperation {
  readonly result: "allowed";
  readonly warnings: readonly OperationWarning[];
  readonly preconditions: readonly Precondition[];
}

/** A valid operation that would not change the repository. */
export interface NoOpOperation {
  readonly result: "no-op";
  readonly reason: string;
  readonly warnings: readonly OperationWarning[];
}

/** An operation that cannot be planned. */
export interface BlockedOperation {
  readonly result: "blocked";
  readonly blockers: readonly OperationBlocker[];
  readonly warnings: readonly OperationWarning[];
}

/** Whether an operation may proceed, has nothing to do, or is blocked. */
export type OperationCheck =
  | AllowedOperation
  | BlockedOperation
  | NoOpOperation;

/** Detects a feature without changing repository state. */
export type Detect = (context: DetectionContext) => Promise<FeatureDetection>;

/** Checks whether enabling a feature is valid. */
export type CheckEnable = (
  context: OperationContext,
) => Promise<OperationCheck>;

/** Checks whether disabling a feature is valid. */
export type CheckDisable = (
  context: OperationContext,
) => Promise<OperationCheck>;

/** Produces the changes required to enable a feature. */
export type PlanEnable = (
  context: OperationContext,
  allowed: AllowedOperation,
) => Promise<ChangePlan>;

/** Produces the changes required to disable a feature. */
export type PlanDisable = (
  context: OperationContext,
  allowed: AllowedOperation,
) => Promise<ChangePlan>;
