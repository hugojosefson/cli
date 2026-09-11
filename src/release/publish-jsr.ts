/** Idempotent JSR publication with registry and provenance verification. */
import type { ReleaseEnvironment } from "./release-environment.ts";
import type { ReleaseProcess } from "./release-process.ts";
import { runOrThrow } from "./release-process.ts";
import { digestBytes } from "../repository/digest-bytes.ts";
import {
  confirmPublication,
  type ReleaseClock,
} from "./confirm-publication.ts";
export type { ReleaseClock } from "./confirm-publication.ts";
import {
  type PublisherFiles,
  type PublisherInput,
  publisherInput,
  versionConfig,
} from "./publisher-input.ts";

type ManifestFile = { readonly size: number; readonly checksum: string };
export type JsrVersion = {
  readonly manifestDigest: string;
  readonly manifest: Readonly<Record<string, ManifestFile>>;
  readonly moduleGraph2: Readonly<Record<string, unknown>>;
  readonly exports: Readonly<Record<string, string>>;
  readonly rekorLogId: number;
};
export type JsrApi = {
  version(name: string, version: string): Promise<JsrVersion | undefined>;
  verifyProvenance(input: ProvenanceInput): Promise<void>;
};
export type PackageFileReader = { read(path: string): Promise<Uint8Array> };
export type ReleaseFetch = (url: string, init?: RequestInit) => Promise<{
  readonly status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;
export type ProvenanceInput = {
  readonly packageName: string;
  readonly version: string;
  readonly sha: string;
  readonly manifestDigest: string;
  readonly rekorLogId: number;
  readonly repository: string;
};

/** Read-only API adapter. Management 404 is the sole absent-version result. */
export function jsrHttpApi(fetch: ReleaseFetch): JsrApi {
  return {
    async version(name, version) {
      const [scope, packageName] = parsePackageName(name);
      const management = await fetch(
        `https://api.jsr.io/scopes/${encodeURIComponent(scope)}/packages/${
          encodeURIComponent(packageName)
        }/versions/${encodeURIComponent(version)}`,
      );
      if (management.status === 404) return undefined;
      if (management.status !== 200) {
        throw new Error("JSR management lookup failed.");
      }
      const record = object(await management.json());
      if (
        !record || record.scope !== scope || record.package !== packageName ||
        record.version !== version || typeof record.yanked !== "boolean" ||
        record.yanked
      ) throw new TypeError("JSR management metadata is invalid.");
      if (record.rekorLogId === null || record.rekorLogId === undefined) {
        throw new Error("JSR provenance metadata is unavailable.");
      }
      const rekorLogId = logId(record.rekorLogId);
      if (rekorLogId === undefined) {
        throw new TypeError("JSR provenance metadata is invalid.");
      }
      const registry = await fetch(
        `https://jsr.io/@${encodeURIComponent(scope)}/${
          encodeURIComponent(packageName)
        }/${encodeURIComponent(version)}_meta.json`,
      );
      if (registry.status !== 200) {
        throw new Error("JSR registry metadata is unavailable.");
      }
      const metadataText = await registry.text();
      const metadata = object(JSON.parse(metadataText));
      if (!metadata) throw new TypeError("JSR registry metadata is invalid.");
      return {
        manifestDigest: await digestBytes(
          new TextEncoder().encode(metadataText),
        ),
        manifest: manifest(metadata.manifest),
        moduleGraph2: graph(metadata.moduleGraph2),
        exports: exportMap(metadata.exports),
        rekorLogId,
      };
    },
    async verifyProvenance(input) {
      const response = await fetch(
        `https://rekor.sigstore.dev/api/v1/log/entries?logIndex=${input.rekorLogId}`,
      );
      if (response.status !== 200) throw new Error("Rekor lookup failed.");
      const entries = object(await response.json());
      if (!entries || Object.keys(entries).length !== 1) {
        throw new TypeError("Rekor entry is ambiguous.");
      }
      const entry = object(Object.values(entries)[0]);
      const verification = object(entry?.verification);
      const signedEntryTimestamp = verification?.signedEntryTimestamp;
      if (
        !entry || !integer(entry.logIndex) ||
        entry.logIndex !== input.rekorLogId ||
        !nonemptyString(entry.body) || !integer(entry.integratedTime) ||
        entry.integratedTime === 0 ||
        typeof entry.logID !== "string" ||
        !/^[0-9a-f]{64}$/.test(entry.logID) ||
        !inclusionProof(verification?.inclusionProof) ||
        !nonemptyString(signedEntryTimestamp)
      ) throw new TypeError("Rekor entry is invalid.");
      const signedEntryTimestampBytes = base64(signedEntryTimestamp);
      if (signedEntryTimestampBytes.length === 0) {
        throw new TypeError("Rekor entry is invalid.");
      }
      const attestation = object(entry.attestation);
      const attestationData = attestation?.data;
      if (typeof attestationData !== "string") {
        throw new TypeError("Rekor attestation is invalid.");
      }
      const data = base64(attestationData);
      await verifyEntryBody(entry.body, data);
      let statement: unknown;
      try {
        statement = JSON.parse(new TextDecoder().decode(data));
      } catch {
        throw new TypeError("Rekor attestation is not JSON.");
      }
      verifyStatement(object(statement), input);
    },
  };
}

export async function publishJsr(input: {
  environment: ReleaseEnvironment;
  process: ReleaseProcess;
  files: PublisherFiles;
  packageFiles: PackageFileReader;
  api: JsrApi;
  clock?: ReleaseClock;
}): Promise<void> {
  const release = await publisherInput(input.environment, input.process);
  if (
    (await runOrThrow(input.process, "git", [
      "status",
      "--porcelain=v1",
      "--untracked-files=normal",
    ])).trim()
  ) {
    throw new TypeError("JSR publication requires a clean release checkout.");
  }
  const config = await versionConfig(input.files, release.version);
  const packageName = jsrPackageName(release.repository);
  if (config.name !== packageName || config.version !== release.version) {
    throw new TypeError("JSR package name or version differs from release.");
  }
  const exports = exportMap(config.exports);
  const verify = (remote: JsrVersion) =>
    verifyVersion(
      remote,
      exports,
      input.packageFiles,
      input.api,
      release,
      packageName,
    );
  const before = await input.api.version(packageName, release.version);
  if (before) return await verify(before);
  if (input.environment.get("GITHUB_SHA") !== release.sha) {
    throw new TypeError(
      "Workflow commit differs from the release. Retry the JSR workflow with --ref set to the release tag.",
    );
  }
  await run(input.process, ["publish", "--dry-run"]);
  let publishFailed = false;
  try {
    await run(input.process, ["publish"]);
  } catch (_error) {
    publishFailed = true;
  }
  const confirmed = await confirmPublication(async () => {
    const remote = await input.api.version(packageName, release.version);
    if (!remote) return false;
    await verify(remote);
    return true;
  }, input.clock);
  if (!confirmed) {
    throw new Error(
      publishFailed
        ? "JSR publication failed and was not confirmed."
        : "JSR publication was not confirmed.",
    );
  }
}

export function jsrPackageName(repository: string): string {
  const parts = repository.split("/");
  const normalized = parts.map((part) => part.toLowerCase());
  if (
    normalized.length !== 2 ||
    !normalized.every((part) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(part))
  ) throw new TypeError("Repository cannot map to a JSR package name.");
  return `@${normalized[0]}/${normalized[1]}`;
}

export function localPackageFiles(root: URL): PackageFileReader {
  return {
    async read(path) {
      if (!safeLocalPath(path)) {
        throw new TypeError("Local JSR module path is invalid.");
      }
      const url = new URL(path, root);
      const info = await Deno.lstat(url);
      if (!info.isFile) {
        throw new TypeError("Local JSR module is not a regular file.");
      }
      return await Deno.readFile(url);
    },
  };
}

async function verifyVersion(
  remote: JsrVersion,
  exports: Record<string, string>,
  files: PackageFileReader,
  api: JsrApi,
  release: PublisherInput,
  name: string,
): Promise<void> {
  if (!sameRecord(remote.exports, exports)) {
    throw new TypeError("JSR exports differ from Deno config.");
  }
  const paths = Object.keys(remote.moduleGraph2);
  if (paths.length === 0) throw new TypeError("JSR module graph is empty.");
  for (const path of Object.values(remote.exports)) {
    const modulePath = `/${path.slice(2)}`;
    if (!remote.moduleGraph2[modulePath]) {
      throw new TypeError("JSR export is missing from the module graph.");
    }
  }
  for (const path of paths) {
    if (!safePath(path) || !remote.manifest[path]) {
      throw new TypeError("JSR module path is invalid.");
    }
  }
  for (const [path, expected] of Object.entries(remote.manifest)) {
    let bytes: Uint8Array;
    try {
      bytes = await files.read(path.slice(1));
    } catch {
      throw new TypeError("Local JSR module cannot be read.");
    }
    // Deno rewrites module imports before upload. The signed manifest digest
    // binds those transformed bytes to the exact release commit instead.
    if (
      !remote.moduleGraph2[path] && (bytes.length !== expected.size ||
        await checksum(bytes) !== expected.checksum)
    ) throw new TypeError("JSR module content differs.");
  }
  await api.verifyProvenance({
    packageName: name,
    version: release.version,
    sha: release.sha,
    manifestDigest: remote.manifestDigest,
    rekorLogId: remote.rekorLogId,
    repository: release.repository,
  });
}

async function checksum(bytes: Uint8Array): Promise<string> {
  return `sha256-${await digestBytes(bytes)}`;
}
function parsePackageName(name: string): [string, string] {
  const match = /^@([a-z0-9][a-z0-9._-]*)\/([a-z0-9][a-z0-9._-]*)$/.exec(name);
  if (!match) throw new TypeError("JSR package name is invalid.");
  return [match[1], match[2]];
}
function manifest(value: unknown): Record<string, ManifestFile> {
  const source = object(value);
  if (!source) throw new TypeError("JSR manifest is invalid.");
  const result: Record<string, ManifestFile> = {};
  for (const [path, item] of Object.entries(source)) {
    const file = object(item);
    if (
      !safePath(path) || !file || !integer(file.size) || file.size < 0 ||
      typeof file.checksum !== "string" ||
      !/^sha256-[0-9a-f]{64}$/.test(file.checksum)
    ) throw new TypeError("JSR manifest is invalid.");
    result[path] = { size: file.size, checksum: file.checksum };
  }
  return result;
}
function graph(value: unknown): Record<string, unknown> {
  const source = object(value);
  if (
    !source ||
    Object.entries(source).some(([path, item]) =>
      !safePath(path) || !object(item)
    )
  ) {
    throw new TypeError("JSR module graph is invalid.");
  }
  return source;
}
function exportMap(value: unknown): Record<string, string> {
  const source = typeof value === "string" ? { ".": value } : object(value);
  if (!source || Object.keys(source).length === 0) {
    throw new TypeError("JSR exports are invalid.");
  }
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(source)) {
    if (
      (key !== "." && !/^\.\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(
        key,
      )) ||
      typeof entry !== "string" || !entry.startsWith("./") ||
      !safePath(`/${entry.slice(2)}`)
    ) {
      throw new TypeError("JSR exports are invalid.");
    }
    result[key] = entry;
  }
  return result;
}
function safePath(path: string): boolean {
  if (!/^\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/.test(path)) {
    return false;
  }
  return !path.slice(1).split("/").some((part) =>
    part === "." || part === ".."
  );
}
function safeLocalPath(path: string): boolean {
  return safePath(`/${path}`) && !path.startsWith("/");
}
function sameRecord(
  left: Record<string, string>,
  right: Record<string, string>,
): boolean {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length &&
    keys.every((key) => left[key] === right[key]);
}
function verifyStatement(
  statement: Record<string, unknown> | undefined,
  input: ProvenanceInput,
): void {
  const subjects = array(statement?.subject);
  const subject = subjects?.length === 1 ? object(subjects[0]) : undefined;
  const predicate = object(statement?.predicate);
  const build = object(predicate?.buildDefinition);
  const external = object(build?.externalParameters);
  const internal = object(build?.internalParameters);
  const workflow = object(external?.workflow);
  const github = object(internal?.github);
  const details = object(predicate?.runDetails);
  const builder = object(details?.builder);
  const metadata = object(details?.metadata);
  if (
    !statement || statement.type !== "https://in-toto.io/Statement/v1" ||
    statement.predicateType !== "https://slsa.dev/provenance/v1" ||
    !subject || !predicate ||
    build?.buildType !==
      "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1" ||
    builder?.id !== "https://github.com/actions/runner/github-hosted" ||
    workflow?.repository !== `https://github.com/${input.repository}` ||
    workflow?.path !== ".github/workflows/hj-release-publish-jsr.yaml" ||
    typeof workflow.ref !== "string" ||
    !/^refs\/(?:heads|tags)\/[^\s]+$/.test(workflow.ref) ||
    (github?.eventName !== "repository_dispatch" &&
      github?.eventName !== "workflow_dispatch") ||
    !/^[1-9]\d*$/.test(String(github?.repositoryId)) ||
    !/^[1-9]\d*$/.test(String(github?.repositoryOwnerId)) ||
    typeof metadata?.invocationId !== "string" ||
    !new RegExp(
      `^https://github\\.com/${
        escapeRegex(input.repository)
      }/actions/runs/[1-9]\\d*/attempts/[1-9]\\d*$`,
    ).test(metadata.invocationId)
  ) throw new TypeError("Rekor provenance differs from release.");
  const digest = object(subject.digest);
  if (
    subject.name !== `pkg:jsr/${input.packageName}@${input.version}` ||
    !digest || Object.keys(digest).length !== 1 ||
    !/^[0-9a-f]{64}$/.test(String(digest.sha256)) ||
    digest.sha256 !== input.manifestDigest
  ) throw new TypeError("Rekor subject differs from release.");
  const dependencies = array(build?.resolvedDependencies);
  if (
    !dependencies || !dependencies.some((value) => {
      const dependency = object(value);
      const digest = object(dependency?.digest);
      return typeof dependency?.uri === "string" &&
        new RegExp(
          `^git\\+https://github\\.com/${
            escapeRegex(input.repository)
          }@refs/(?:heads|tags)/[^\\s]+$`,
        ).test(dependency.uri) &&
        digest?.gitCommit === input.sha;
    })
  ) throw new TypeError("Rekor dependency differs from release.");
}
async function verifyEntryBody(body: string, data: Uint8Array): Promise<void> {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(base64(body)));
  } catch {
    throw new TypeError("Rekor entry body is invalid.");
  }
  const entry = object(value);
  const spec = object(entry?.spec);
  const content = object(spec?.content);
  const envelope = object(content?.envelope);
  const payloadHash = object(content?.payloadHash);
  const hash = object(content?.hash);
  const signatures = array(envelope?.signatures);
  if (
    entry?.apiVersion !== "0.0.2" || entry.kind !== "intoto" || !content ||
    envelope?.payloadType !== "application/vnd.in-toto+json" ||
    !signatures || signatures.length === 0 ||
    signatures.some((signature) => {
      const value = object(signature);
      return !nonemptyString(value?.publicKey) ||
        base64(value.publicKey).length === 0 ||
        !nonemptyString(value.sig) || base64(value.sig).length === 0;
    }) ||
    !sha256Hash(payloadHash) || !sha256Hash(hash) ||
    payloadHash.value !== await sha256(data)
  ) throw new TypeError("Rekor entry body is invalid.");
}
function inclusionProof(value: unknown): boolean {
  const proof = object(value);
  const hashes = array(proof?.hashes);
  return !!proof && integer(proof.logIndex) && integer(proof.treeSize) &&
    proof.treeSize > 0 && typeof proof.rootHash === "string" &&
    /^[0-9a-f]{64}$/.test(proof.rootHash) && !!hashes &&
    hashes.every((hash) =>
      typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash)
    ) &&
    nonemptyString(proof.checkpoint);
}
function sha256Hash(value: Record<string, unknown> | undefined): value is {
  readonly algorithm: "sha256";
  readonly value: string;
} {
  return value?.algorithm === "sha256" && typeof value.value === "string" &&
    /^[0-9a-f]{64}$/.test(value.value);
}
async function sha256(bytes: Uint8Array): Promise<string> {
  const source = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", source));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function base64(value: string): Uint8Array {
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  ) {
    throw new TypeError("Rekor base64 encoding is invalid.");
  }
  try {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  } catch {
    throw new TypeError("Rekor attestation encoding is invalid.");
  }
}
function object(value: unknown): Record<string, unknown> | undefined {
  return !!value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
function array(value: unknown): readonly unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}
function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function logId(value: unknown): number | undefined {
  if (integer(value) && value > 0) return value;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}
function nonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
async function run(
  process: ReleaseProcess,
  args: readonly string[],
): Promise<void> {
  const result = await process.run("deno", args);
  if (!result.success) {
    throw new Error(`JSR command failed: deno ${args.join(" ")}.`);
  }
}
