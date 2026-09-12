/** @module Exact repository artifact inspection contracts. */

import type { FileAccess } from "./file-access.ts";

import type {
  DirectoryStateDigest,
  FileDigest,
  FileMode,
  JsonValue,
  RepositoryPath,
} from "./json.ts";
import type { FeatureArtifact } from "./feature-artifact.ts";

/** A structured mismatch between a declared artifact and repository state. */
export type ArtifactDifference =
  | {
    readonly kind: "text";
    readonly subject: string;
    readonly expected: string;
    readonly actual: string;
  }
  | {
    readonly kind: "json";
    readonly subject: string;
    readonly expected: JsonValue;
    readonly actual: JsonValue;
  }
  | {
    readonly kind: "missing";
    readonly subject: string;
    readonly expected: string;
  }
  | {
    readonly kind: "invalid";
    readonly subject: string;
    readonly observation: string;
  };

/** The observed result of inspecting one declared feature artifact. */
export type ArtifactInspection =
  | { readonly result: "absent"; readonly artifact: FeatureArtifact }
  | { readonly result: "matches"; readonly artifact: FeatureArtifact }
  | {
    readonly result: "differs";
    readonly artifact: FeatureArtifact;
    readonly owned: boolean;
    readonly differences: readonly ArtifactDifference[];
  }
  | {
    readonly result: "unreadable";
    readonly artifact: FeatureArtifact;
    readonly observation: string;
  };

/** An exact artifact shape declared by a feature. */
export type ArtifactSchema =
  | { readonly kind: "absent"; readonly path: RepositoryPath }
  | {
    readonly kind: "file";
    readonly path: RepositoryPath;
    readonly content: string;
    /** Creation mode; owner bits describe required current-user access. */
    readonly mode: FileMode;
  }
  | {
    readonly kind: "directory";
    readonly path: RepositoryPath;
    readonly stateDigest: DirectoryStateDigest;
  }
  | {
    readonly kind: "symlink";
    readonly path: RepositoryPath;
    readonly target: string;
  };

/** A filesystem observation supplied by a repository adapter. */
export type ArtifactObservation =
  | { readonly kind: "absent" }
  | {
    readonly kind: "file";
    readonly content: string;
    readonly digest: FileDigest;
    readonly mode: FileMode;
    readonly access?: FileAccess;
  }
  | {
    readonly kind: "directory";
    readonly stateDigest: DirectoryStateDigest;
    readonly access?: FileAccess;
  }
  | { readonly kind: "symlink"; readonly target: string }
  | { readonly kind: "unreadable"; readonly observation: string };

/** One field that differs from an exact schema. */
export type ExactArtifactDifference =
  | {
    readonly kind: "artifact-kind";
    readonly expected: ArtifactSchema["kind"];
    readonly actual: Exclude<ArtifactObservation["kind"], "unreadable">;
  }
  | {
    readonly kind: "content";
    readonly expected: string;
    readonly actual: string;
  }
  | {
    readonly kind: "mode";
    readonly expected: FileMode;
    readonly actual: FileMode;
  }
  | {
    readonly kind: "directory-state";
    readonly expected: DirectoryStateDigest;
    readonly actual: DirectoryStateDigest;
  }
  | {
    readonly kind: "symlink-target";
    readonly expected: string;
    readonly actual: string;
  };

/** The result of comparing one observation against an exact schema. */
export type ExactArtifactInspection =
  | {
    readonly result: "matches";
    readonly schema: ArtifactSchema;
    readonly observation: Exclude<
      ArtifactObservation,
      { readonly kind: "unreadable" }
    >;
  }
  | {
    readonly result: "absent";
    readonly schema: Exclude<ArtifactSchema, { readonly kind: "absent" }>;
  }
  | {
    readonly result: "differs";
    readonly schema: ArtifactSchema;
    readonly observation: Exclude<
      ArtifactObservation,
      { readonly kind: "unreadable" }
    >;
    readonly differences: readonly ExactArtifactDifference[];
  }
  | {
    readonly result: "unreadable";
    readonly schema: ArtifactSchema;
    readonly observation: string;
  };
