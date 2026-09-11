/** @module Canonical, fail-closed release-bundle wire data. */

import { digestBytes } from "../repository/digest-bytes.ts";
import {
  applyChangelogInsertion,
  type ChangelogInsertion,
} from "./changelog.ts";
import type { ReleaseType } from "./release-type.ts";
import { parseSemver } from "./semver.ts";

export const releaseBundleSchema = 1;
export const changelogPath = "CHANGELOG.md";

export type ReleaseBundle = {
  readonly schema: typeof releaseBundleSchema;
  readonly previousTag: string | null;
  readonly previousTagTarget: string | null;
  readonly selectedSha: string;
  readonly previousVersion: string;
  readonly nextVersion: string;
  readonly releaseType: ReleaseType;
  readonly versionFile: {
    readonly path: string;
    readonly previousDigest: string;
    readonly text: string;
    readonly digest: string;
  };
  readonly changelog: {
    readonly path: typeof changelogPath;
    readonly previousDigest: string | null;
    readonly offset: number;
    readonly insertion: string;
    readonly digest: string;
  };
  readonly changedPaths: readonly string[];
  readonly treeDigest: string;
};

const hex = /^[0-9a-f]{64}$/;
const sha = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const encoder = new TextEncoder();

/** Serializes the fixed schema with its specified field order and no whitespace. */
export function canonicalReleaseBundle(bundle: ReleaseBundle): string {
  return JSON.stringify({
    schema: bundle.schema,
    previousTag: bundle.previousTag,
    previousTagTarget: bundle.previousTagTarget,
    selectedSha: bundle.selectedSha,
    previousVersion: bundle.previousVersion,
    nextVersion: bundle.nextVersion,
    releaseType: bundle.releaseType,
    versionFile: bundle.versionFile,
    changelog: bundle.changelog,
    changedPaths: bundle.changedPaths,
    treeDigest: bundle.treeDigest,
  });
}

/** Validates every wire field that does not require the selected tree. */
export function validateReleaseBundle(bundle: unknown): ReleaseBundle {
  if (
    !isRecord(bundle) ||
    Object.keys(bundle).join(",") !==
      "schema,previousTag,previousTagTarget,selectedSha,previousVersion,nextVersion,releaseType,versionFile,changelog,changedPaths,treeDigest"
  ) {
    throw new TypeError("Release bundle fields are incorrect.");
  }
  const value = bundle as ReleaseBundle;
  if (
    value.schema !== releaseBundleSchema || !sha.test(value.selectedSha) ||
    !parseSemver(value.previousVersion) || !parseSemver(value.nextVersion) ||
    !["major", "minor", "patch"].includes(value.releaseType) ||
    !hex.test(value.treeDigest) ||
    (value.previousTag === null) !== (value.previousTagTarget === null) ||
    (value.previousTag !== null &&
      (!parseSemver(value.previousTag) || !sha.test(value.previousTagTarget!)))
  ) {
    throw new TypeError("Release bundle metadata is invalid.");
  }
  validateVersionFile(value.versionFile);
  validateChangelog(value.changelog);
  const paths = [value.versionFile.path, value.changelog.path];
  if (!samePaths(value.changedPaths, paths)) {
    throw new TypeError("Release bundle changed paths are invalid.");
  }
  return value;
}

/** Checks previous and completed-file digests against the selected source texts. */
export async function validateReleaseBundleFiles(
  bundle: ReleaseBundle,
  oldVersionText: string,
  oldChangelogText: string | undefined,
): Promise<void> {
  validateReleaseBundle(bundle);
  if (await digestText(oldVersionText) !== bundle.versionFile.previousDigest) {
    throw new TypeError(
      "Release bundle version-file previous digest is invalid.",
    );
  }
  if (oldChangelogText === undefined) {
    if (
      bundle.changelog.previousDigest !== null || bundle.changelog.offset !== 0
    ) {
      throw new TypeError("Release bundle changelog absence is invalid.");
    }
    oldChangelogText = "";
  } else if (
    bundle.changelog.previousDigest === null ||
    await digestText(oldChangelogText) !== bundle.changelog.previousDigest
  ) {
    throw new TypeError("Release bundle changelog previous digest is invalid.");
  }
  if (
    await digestText(bundle.versionFile.text) !== bundle.versionFile.digest ||
    await digestText(applyBundleChangelog(oldChangelogText, bundle)) !==
      bundle.changelog.digest
  ) {
    throw new TypeError("Release bundle new file digest is invalid.");
  }
}

/** Encodes only a validated canonical bundle into unpadded base64url. */
export async function encodeReleaseBundle(
  bundle: ReleaseBundle,
): Promise<{ readonly bundle: string; readonly digest: string }> {
  validateReleaseBundle(bundle);
  const text = canonicalReleaseBundle(bundle);
  const bytes = encoder.encode(text);
  return { bundle: base64url(bytes), digest: await digestBytes(bytes) };
}

/** Decodes, validates canonical form, and verifies the supplied SHA-256 digest. */
export async function decodeReleaseBundle(
  encoded: string,
  digest: string,
): Promise<ReleaseBundle> {
  if (!/^[A-Za-z0-9_-]+$/.test(encoded) || !hex.test(digest)) {
    throw new TypeError("Release bundle encoding or digest is invalid.");
  }
  const bytes = fromBase64url(encoded);
  if (await digestBytes(bytes) !== digest) {
    throw new TypeError("Release bundle digest does not match.");
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TypeError("Release bundle is not JSON.");
  }
  const bundle = validateReleaseBundle(parsed);
  if (canonicalReleaseBundle(bundle) !== text) {
    throw new TypeError("Release bundle is not canonical.");
  }
  return bundle;
}

/** Applies exactly the bundle's recorded changelog change. */
export function applyBundleChangelog(
  oldText: string,
  bundle: ReleaseBundle,
): string {
  return applyChangelogInsertion(
    oldText,
    {
      offset: bundle.changelog.offset,
      text: bundle.changelog.insertion,
    } satisfies ChangelogInsertion,
  );
}

async function digestText(text: string): Promise<string> {
  return await digestBytes(encoder.encode(text));
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function validateVersionFile(
  value: unknown,
): asserts value is ReleaseBundle["versionFile"] {
  if (
    !isRecord(value) ||
    Object.keys(value).join(",") !== "path,previousDigest,text,digest" ||
    typeof value.path !== "string" || !validPath(value.path) ||
    typeof value.previousDigest !== "string" ||
    !hex.test(value.previousDigest) || typeof value.text !== "string" ||
    typeof value.digest !== "string" || !hex.test(value.digest)
  ) throw new TypeError("Release bundle version file is invalid.");
}
function validateChangelog(
  value: unknown,
): asserts value is ReleaseBundle["changelog"] {
  if (
    !isRecord(value) ||
    Object.keys(value).join(",") !==
      "path,previousDigest,offset,insertion,digest" ||
    value.path !== changelogPath ||
    (value.previousDigest !== null &&
      (typeof value.previousDigest !== "string" ||
        !hex.test(value.previousDigest))) ||
    typeof value.offset !== "number" || !Number.isSafeInteger(value.offset) ||
    value.offset < 0 || typeof value.insertion !== "string" ||
    typeof value.digest !== "string" || !hex.test(value.digest)
  ) throw new TypeError("Release bundle changelog is invalid.");
}
function validPath(path: string): boolean {
  return path !== "" && !path.startsWith("/") && !path.includes("\\") &&
    !path.split("/").some((part) =>
      part === "" || part === "." || part === ".."
    );
}
function samePaths(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  return Array.isArray(actual) && actual.length === expected.length &&
    actual.every((path, index) =>
      typeof path === "string" && path === expected[index]
    ) && new Set(actual).size === actual.length;
}
function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(
    /=+$/,
    "",
  );
}
function fromBase64url(value: string): Uint8Array {
  const binary = atob(
    value.replaceAll("-", "+").replaceAll("_", "/") +
      "=".repeat((4 - value.length % 4) % 4),
  );
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
