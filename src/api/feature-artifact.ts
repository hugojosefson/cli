/** @module Declarative feature artifact contracts. */

import type { FeatureId } from "./feature.ts";
import type {
  FileMode,
  JsonObject,
  JsonValue,
  RepositoryPath,
} from "./json.ts";
import type { JsonPathSegment } from "./planned-change.ts";

/** Whether a feature fully owns an artifact or only seeds it for user edits. */
export type ArtifactOwnership = "owned" | "seed";

/** A named feature template and the non-secret values used to render it. */
export interface TemplateReference {
  readonly featureId: FeatureId;
  readonly name: string;
  readonly variables: JsonObject;
}

/** A repository file rendered from a template and owned or seeded by a feature. */
export interface TemplateFileArtifact {
  readonly kind: "template-file";
  readonly path: RepositoryPath;
  readonly template: TemplateReference;
  readonly ownership: ArtifactOwnership;
  readonly mode?: FileMode;
}

/** A JSON value that a feature owns or seeds in a repository file. */
export interface JsonDefinitionArtifact {
  readonly kind: "json-definition";
  readonly path: RepositoryPath;
  readonly jsonPath: readonly JsonPathSegment[];
  readonly expected: JsonValue;
  readonly ownership: ArtifactOwnership;
}

/** A Deno task definition expected in repository configuration. */
export interface DenoTaskDefinition {
  readonly description: string;
  readonly command?: string;
  readonly dependencies?: readonly string[];
}

/** A Deno task that a feature owns or seeds in a config file. */
export interface DenoTaskArtifact {
  readonly kind: "deno-task";
  readonly name: string;
  readonly configPath: RepositoryPath;
  readonly definition: DenoTaskDefinition;
  readonly ownership: ArtifactOwnership;
}

/** A desired file mode for a feature-owned or feature-seeded path. */
export interface ModeArtifact {
  readonly kind: "mode";
  readonly path: RepositoryPath;
  readonly mode: FileMode;
  readonly ownership: ArtifactOwnership;
}

/** A desired GitHub resource and its definition. */
export interface GithubResourceArtifact {
  readonly kind: "github-resource";
  readonly resource: string;
  readonly name: string;
  readonly definition: JsonObject;
  readonly ownership: ArtifactOwnership;
}

/** A declarative resource owned by a feature. */
export type FeatureArtifact =
  | TemplateFileArtifact
  | JsonDefinitionArtifact
  | DenoTaskArtifact
  | ModeArtifact
  | GithubResourceArtifact;
