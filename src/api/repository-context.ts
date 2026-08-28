/** @module Read-only repository and operation context contracts. */

import type { FeatureDetection } from "./feature-detection.ts";
import type { FeatureId } from "./feature.ts";
import type {
  RepairSelection,
  RequestedFeatureChange,
  ResolvedFeatureChange,
} from "./feature-change.ts";
import type {
  DirectoryStateDigest,
  FileDigest,
  FileMode,
  JsonObject,
  JsonValue,
  RepositoryPath,
} from "./json.ts";
import type { ArtifactObservation } from "./artifact-inspection.ts";

/** JSON content read from a repository file. */
export interface FileJson {
  readonly value: JsonValue;
  readonly digest: FileDigest;
}

/** Read-only access to files in the target repository. */
export interface FileReader {
  /** Observes an artifact without following a final symlink. */
  observe(path: RepositoryPath): Promise<ArtifactObservation>;
  exists(path: RepositoryPath): Promise<boolean>;
  readText(path: RepositoryPath): Promise<string | undefined>;
  readJson(path: RepositoryPath): Promise<FileJson | undefined>;
  digest(path: RepositoryPath): Promise<FileDigest | undefined>;
  /** Digests a directory and its contents for a safe planned removal. */
  directoryStateDigest(
    path: RepositoryPath,
  ): Promise<DirectoryStateDigest | undefined>;
  mode(path: RepositoryPath): Promise<FileMode | undefined>;
}

/** The checked-out Git commit and branch, when available. */
export interface GitHead {
  readonly commit: string;
  readonly branch?: string;
}

/** The parts of Git status relevant to safe planned changes. */
export interface GitStatus {
  readonly isClean: boolean;
  readonly changedPaths: readonly RepositoryPath[];
}

/** A configured Git remote. */
export interface GitRemote {
  readonly name: string;
  readonly url: string;
}

/** Read-only facts from the local Git repository. */
export interface GitReader {
  isRepository(): Promise<boolean>;
  head(): Promise<GitHead | undefined>;
  /** Reports status for the whole repository or only the requested paths. */
  status(
    paths?: readonly RepositoryPath[],
    options?: { readonly includeIgnored?: boolean },
  ): Promise<GitStatus | undefined>;
  remotes(): Promise<readonly GitRemote[]>;
  defaultBranch(): Promise<string | undefined>;
  /** Local identity used for non-secret repository attribution. */
  userName?(): Promise<string | undefined>;
}

/** GitHub facts needed by feature checks. */
export interface GithubRepository {
  readonly owner: string;
  readonly name: string;
  readonly defaultBranch?: string;
}

/** A GitHub resource with a digest of the state relevant to `hj`. */
export interface GithubResource {
  readonly kind: string;
  readonly name: string;
  readonly stateDigest: string;
  readonly definition: JsonObject;
}

/** Read-only GitHub access, present only when GitHub can be queried. */
export interface GithubReader {
  /** Authenticated viewer identity, when the adapter supports it. */
  viewer?(): Promise<{ readonly name: string } | undefined>;
  repository(): Promise<GithubRepository | undefined>;
  /** `undefined` means the rulesets API could not be read. */
  rulesets(): Promise<readonly GithubResource[] | undefined>;
  environments(): Promise<readonly GithubResource[]>;
  variables(): Promise<readonly GithubResource[]>;
  secretExists(
    environment: string,
    name: string,
  ): Promise<boolean | undefined>;
  resource(kind: string, name: string): Promise<GithubResource | undefined>;
}

/** Authenticated GitHub mutations, with optimistic per-resource state checks. */
export interface GithubWriter extends GithubReader {
  /** Applies compatible resources. Some resource types require sequential requests. */
  upsertResources(
    resources: readonly GithubResourceUpsert[],
  ): Promise<void>;
  /** Removes resources after a fresh optimistic state check. */
  deleteResources(resources: readonly GithubResourceDelete[]): Promise<void>;
}

/** A requested GitHub resource replacement with its observed state digest. */
export interface GithubResourceUpsert {
  readonly resource: string;
  readonly name: string;
  readonly definition: JsonObject;
  /** `undefined` asserts that the resource must be absent. */
  readonly expectedStateDigest: string | undefined;
}

/** A requested GitHub resource deletion with its observed state digest. */
export interface GithubResourceDelete {
  readonly resource: string;
  readonly name: string;
  readonly expectedStateDigest: string;
}

/** Authenticated GitHub viewer lookup independent of repository access. */
export interface GithubIdentityReader {
  viewer(): Promise<{ readonly name: string } | undefined>;
}

/** Services available while detecting a feature without changing the repository. */
export interface DetectionContext {
  readonly repositoryRoot: URL;
  readonly files: FileReader;
  readonly git: GitReader;
  readonly github?: GithubReader;
  readonly githubIdentity?: GithubIdentityReader;
}

/** Read-only context shared by checks and planners for one repository operation. */
export interface OperationContext extends DetectionContext {
  readonly detections: ReadonlyMap<FeatureId, FeatureDetection>;
  readonly requestedChanges: readonly RequestedFeatureChange[];
  readonly resolvedChanges: readonly ResolvedFeatureChange[];
  /** Explicit drift-repair intent, separate from state-change resolution. */
  readonly repair: RepairSelection | undefined;
  /** Non-secret options resolved before planning starts. */
  readonly options: JsonObject;
}
