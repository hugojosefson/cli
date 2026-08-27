/** @module Ordered structured repository change contracts. */

import type {
  DirectoryStateDigest,
  FileDigest,
  FileMode,
  JsonObject,
  JsonValue,
  RepositoryPath,
} from "./json.ts";

/** Creates a repository directory when absent, or accepts an existing directory. */
export interface CreateDirectoryChange {
  readonly kind: "create-directory";
  readonly path: RepositoryPath;
}

/** Writes file content after checking its prior digest or absence. */
export interface WriteFileChange {
  readonly kind: "write-file";
  readonly path: RepositoryPath;
  readonly content: string;
  /** Applies this mode as part of the write when the file is created. */
  readonly mode?: FileMode;
  /** `undefined` asserts that the file must be absent. */
  readonly expectedDigest: FileDigest | undefined;
}

/** Creates a symbolic link after confirming that its path is absent. */
export interface CreateSymlinkChange {
  readonly kind: "create-symlink";
  readonly path: RepositoryPath;
  readonly target: string;
}

/** Removes a symbolic link after confirming its target. */
export interface RemoveSymlinkChange {
  readonly kind: "remove-symlink";
  readonly path: RepositoryPath;
  readonly expectedTarget: string;
}

/** Removes a file after checking its current digest. */
export interface RemoveFileChange {
  readonly kind: "remove-file";
  readonly path: RepositoryPath;
  readonly expectedDigest: FileDigest;
}

/** Removes a directory only when its complete state still matches the plan. */
export interface RemoveDirectoryChange {
  readonly kind: "remove-directory";
  readonly path: RepositoryPath;
  readonly expectedStateDigest: DirectoryStateDigest;
}

/** Changes a file mode after checking its prior mode or absence. */
export interface FileModeChange {
  readonly kind: "set-file-mode";
  readonly path: RepositoryPath;
  readonly mode: FileMode;
  readonly expectedMode: FileMode | undefined;
}

/** An object key or array index within a JSON document. */
export type JsonPathSegment = string | number;

/** Sets or removes a JSON value at a path of object keys or array indexes. */
export type JsonChange =
  | {
    readonly kind: "set-json";
    readonly path: RepositoryPath;
    readonly jsonPath: readonly JsonPathSegment[];
    readonly value: JsonValue;
    readonly expected: JsonValue | undefined;
  }
  | {
    readonly kind: "remove-json";
    readonly path: RepositoryPath;
    readonly jsonPath: readonly JsonPathSegment[];
    readonly expected: JsonValue;
  };

/** Initializes, commits to, branches, or configures a local Git repository. */
export type GitChange =
  | { readonly kind: "git-init"; readonly defaultBranch?: string }
  | {
    readonly kind: "git-commit";
    readonly message: string;
    readonly paths: readonly RepositoryPath[];
    readonly allowEmpty: boolean;
  }
  | {
    readonly kind: "create-git-branch";
    readonly name: string;
    readonly startPoint?: string;
  }
  | {
    readonly kind: "set-git-remote";
    readonly name: string;
    readonly url: string;
    readonly expectedUrl?: string;
  };

/** Upserts or deletes a Github resource after checking its prior state. */
export type GithubChange =
  | {
    readonly kind: "upsert-github-resource";
    readonly resource: string;
    readonly name: string;
    readonly definition: JsonObject;
    /** `undefined` asserts that the resource must be absent. */
    readonly expectedStateDigest: string | undefined;
  }
  | {
    readonly kind: "delete-github-resource";
    readonly resource: string;
    readonly name: string;
    readonly expectedStateDigest: string;
  };

/** Application setup work that contains configuration but never secret values. */
export interface AppSetupChange {
  readonly kind: "app-setup";
  readonly name: string;
  readonly repository: string;
  readonly environment: string;
  readonly secretName: string;
  readonly nonSecretConfiguration: JsonObject;
}

/** One ordered change in a plan. */
export type PlannedChange =
  | CreateDirectoryChange
  | WriteFileChange
  | CreateSymlinkChange
  | RemoveSymlinkChange
  | RemoveFileChange
  | RemoveDirectoryChange
  | FileModeChange
  | JsonChange
  | GitChange
  | GithubChange
  | AppSetupChange;
