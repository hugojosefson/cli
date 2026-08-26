/** @module Feature change plan and validation contracts. */

import type { FeatureId } from "./feature.ts";
import type { OperationWarning } from "./feature-operation.ts";
import type {
  DirectoryStateDigest,
  FileDigest,
  RepositoryPath,
} from "./json.ts";
import type { PlannedChange } from "./planned-change.ts";

/** A condition that must still hold before a plan can be applied. */
export type Precondition =
  | {
    readonly kind: "file-digest";
    readonly path: RepositoryPath;
    readonly digest: FileDigest | undefined;
  }
  | { readonly kind: "git-repository"; readonly exists: boolean }
  | { readonly kind: "git-head"; readonly commit: string | undefined }
  | { readonly kind: "clean-worktree" }
  | {
    readonly kind: "directory-state";
    readonly path: RepositoryPath;
    readonly digest: DirectoryStateDigest | undefined;
  }
  | {
    readonly kind: "github-resource-state";
    readonly resource: string;
    readonly name: string;
    readonly stateDigest: string | undefined;
  };

/** A non-secret validation to run after planned changes are applied. */
export type PlannedValidation =
  | {
    readonly kind: "command";
    readonly description: string;
    readonly command: string;
    readonly args: readonly string[];
  }
  | {
    readonly kind: "feature-redetection";
    readonly featureId: FeatureId;
    readonly expected: "enabled" | "disabled";
  }
  | { readonly kind: "clean-tree" }
  | {
    readonly kind: "remote-state";
    readonly name: string;
    readonly url: string;
  };

/** An ordered, side-effect-free description of one feature operation. */
export interface ChangePlan {
  readonly featureId: FeatureId;
  readonly action: "enable" | "disable";
  readonly summary: string;
  readonly warnings: readonly OperationWarning[];
  readonly preconditions: readonly Precondition[];
  readonly changes: readonly PlannedChange[];
  readonly validations: readonly PlannedValidation[];
}
