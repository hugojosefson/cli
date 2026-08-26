/** @module JSON and repository value contracts. */

/** A value that can appear in a JSON document. */
export type JsonValue =
  | boolean
  | null
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** A JSON object with string keys. */
export type JsonObject = { readonly [key: string]: JsonValue };

/** A path relative to the repository root. */
export type RepositoryPath = string;

/** A content digest reported by a file reader. */
export type FileDigest = string;

/** Digest of a directory's complete state, including its contents. */
export type DirectoryStateDigest = string;

/** A Unix file mode represented as a numeric value. */
export type FileMode = number;
