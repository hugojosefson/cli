/** @module Artifact inspection and difference contracts. */

import type { JsonValue } from "./json.ts";
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

/** The observed result of inspecting one declared artifact. */
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
