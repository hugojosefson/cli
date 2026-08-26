/** @module Declarative feature definition, inspection, and planning contracts. */

import type { ArtifactInspection } from "./artifact-inspection.ts";
import type { FeatureCapabilities } from "./capability.ts";
import type { FeatureArtifact } from "./feature-artifact.ts";
import type {
  Feature,
  FeatureDependencies,
  FeatureMetadata,
} from "./feature.ts";
import type { AllowedOperation, OperationCheck } from "./feature-operation.ts";
import type { ChangePlan } from "./change-plan.ts";
import type { JsonObject } from "./json.ts";
import type {
  DetectionContext,
  OperationContext,
} from "./repository-context.ts";

/** Non-secret inputs used to derive a feature's declared artifacts. */
export interface DeclarationContext {
  readonly repositoryRoot: URL;
  readonly options: JsonObject;
}

/** Derives artifacts from resolved, non-secret declaration inputs. */
export type ArtifactDeclaration = (
  context: DeclarationContext,
) => readonly FeatureArtifact[];

/** An additional domain check that supplements artifact inspection. */
export type DeclarativeFeatureCheck = (
  context: OperationContext,
) => Promise<OperationCheck>;

/** Data needed to derive a feature from artifacts and supplemental checks. */
export interface DeclarativeFeatureDefinition {
  readonly metadata: FeatureMetadata;
  readonly dependencies: FeatureDependencies;
  readonly capabilities: FeatureCapabilities;
  readonly artifacts: ArtifactDeclaration;
  readonly enableChecks: readonly DeclarativeFeatureCheck[];
  readonly disableChecks: readonly DeclarativeFeatureCheck[];
}

/** Inspects declared artifacts without changing repository state. */
export interface ArtifactInspector {
  inspect(
    artifact: FeatureArtifact,
    context: DetectionContext,
  ): Promise<ArtifactInspection>;
}

/** Checks inspections and converts allowed work into a side-effect-free plan. */
export interface ArtifactPlanner {
  checkEnable(
    inspections: readonly ArtifactInspection[],
    context: OperationContext,
  ): Promise<OperationCheck>;
  planEnable(
    inspections: readonly ArtifactInspection[],
    context: OperationContext,
    allowed: AllowedOperation,
  ): Promise<ChangePlan>;
  checkDisable(
    inspections: readonly ArtifactInspection[],
    context: OperationContext,
  ): Promise<OperationCheck>;
  planDisable(
    inspections: readonly ArtifactInspection[],
    context: OperationContext,
    allowed: AllowedOperation,
  ): Promise<ChangePlan>;
}

/** Declares the helper signature used to derive a feature from its definition. */
export declare function defineDeclarativeFeature(
  definition: DeclarativeFeatureDefinition,
  inspector: ArtifactInspector,
  planner: ArtifactPlanner,
): Feature;
