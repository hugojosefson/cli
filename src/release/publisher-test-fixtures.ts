import type { PublisherFiles } from "./publisher-input.ts";
import type { ReleaseEnvironment } from "./release-environment.ts";
import {
  localReleaseProcess,
  type ReleaseProcess,
  runOrThrow,
} from "./release-process.ts";
import type { JsrVersion } from "./publish-jsr.ts";

export const sha = "a".repeat(40);
export const encoder = new TextEncoder();
export const checksum =
  "sha256-2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881";
export function ok(stdout = "") {
  return {
    success: true as const,
    code: 0,
    stdout: encoder.encode(stdout),
    stderr: new Uint8Array(),
  };
}
export function environment(
  overrides: Record<string, string | undefined> = {},
): ReleaseEnvironment {
  const values = {
    HJ_RELEASE_ROUTE: "event",
    HJ_RELEASE_SCHEMA: "1",
    HJ_RELEASE_TAG: "1.2.3",
    HJ_RELEASE_VERSION: "1.2.3",
    HJ_RELEASE_SHA: sha,
    GITHUB_REPOSITORY: "owner/repo",
    GITHUB_SHA: sha,
    ...overrides,
  };
  return { get: (name) => values[name as keyof typeof values] };
}
export function process(
  calls: string[],
  output: Record<string, string> = {},
): ReleaseProcess {
  return {
    run(command, args) {
      const key = `${command} ${args.join(" ")}`;
      calls.push(key);
      return Promise.resolve(
        ok(
          output[key] ??
            (args[0] === "status"
              ? ""
              : args[0] === "ls-remote"
              ? `${sha}\trefs/tags/1.2.3\n`
              : `${sha}\n`),
        ),
      );
    },
  };
}
export function files(
  text = '{"name":"@owner/repo","version":"1.2.3","exports":"./mod.ts"}',
): PublisherFiles {
  return {
    observe: (path) =>
      Promise.resolve(
        path === "deno.json"
          ? { kind: "file" as const, bytes: encoder.encode(text) }
          : { kind: "absent" as const },
      ),
  };
}
export function remote(): JsrVersion {
  return {
    manifestDigest: "b".repeat(64),
    manifest: { "/mod.ts": { size: 1, checksum } },
    moduleGraph2: { "/mod.ts": {} },
    exports: { ".": "./mod.ts" },
    rekorLogId: 7,
  };
}
export async function createGitSymlink(
  root: URL,
  path: string,
  target: string,
): Promise<void> {
  const git = localReleaseProcess(root);
  await runOrThrow(git, "git", ["init"]);
  const oid = (await runOrThrow(git, "git", ["hash-object", "-w", "--stdin"], {
    stdin: target,
  })).trim();
  await runOrThrow(git, "git", [
    "update-index",
    "--add",
    "--cacheinfo",
    "120000",
    oid,
    path,
  ]);
  await runOrThrow(git, "git", ["checkout-index", "--force", "--", path]);
}
export async function rekor(
  mutate: (
    statement: Record<string, unknown>,
    entry: Record<string, unknown>,
    body: Record<string, unknown>,
  ) => void = () => {},
): Promise<unknown> {
  const statement: Record<string, unknown> = {
    type: "https://in-toto.io/Statement/v1",
    predicateType: "https://slsa.dev/provenance/v1",
    subject: [{
      name: "pkg:jsr/@owner/repo@1.2.3",
      digest: { sha256: "b".repeat(64) },
    }],
    predicate: {
      buildDefinition: {
        buildType:
          "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
        externalParameters: {
          workflow: {
            repository: "https://github.com/owner/repo",
            path: ".github/workflows/hj-release-publish-jsr.yaml",
            ref: "refs/heads/main",
          },
        },
        internalParameters: {
          github: {
            eventName: "repository_dispatch",
            repositoryId: "1",
            repositoryOwnerId: "2",
          },
        },
        resolvedDependencies: [{
          uri: "git+https://github.com/owner/repo@refs/heads/main",
          digest: { gitCommit: sha },
        }],
      },
      runDetails: {
        builder: { id: "https://github.com/actions/runner/github-hosted" },
        metadata: {
          invocationId:
            "https://github.com/owner/repo/actions/runs/1/attempts/1",
        },
      },
    },
  };
  const entry: Record<string, unknown> = {
    logIndex: 7,
    integratedTime: 1,
    logID: "c".repeat(64),
    verification: {
      inclusionProof: {
        logIndex: 7,
        treeSize: 8,
        rootHash: "d".repeat(64),
        hashes: ["e".repeat(64)],
        checkpoint: "rekor checkpoint",
      },
      signedEntryTimestamp: btoa("stamp"),
    },
  };
  const initialData = encoder.encode(JSON.stringify(statement));
  const initialDigest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", initialData),
  );
  const initialDigestHex = [...initialDigest].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  const payloadHash: Record<string, unknown> = {
    algorithm: "sha256",
    value: initialDigestHex,
  };
  const body: Record<string, unknown> = {
    apiVersion: "0.0.2",
    kind: "intoto",
    spec: {
      content: {
        envelope: {
          payloadType: "application/vnd.in-toto+json",
          signatures: [{
            publicKey: btoa("public key"),
            sig: btoa("signature"),
          }],
        },
        hash: { algorithm: "sha256", value: "f".repeat(64) },
        payloadHash,
      },
    },
  };
  mutate(statement, entry, body);
  const data = encoder.encode(JSON.stringify(statement));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  const digestHex = [...digest].map((byte) =>
    byte.toString(16).padStart(2, "0")
  )
    .join("");
  if (payloadHash.value === initialDigestHex) {
    payloadHash.value = digestHex;
  }
  entry.attestation = { data: btoa(JSON.stringify(statement)) };
  entry.body = btoa(JSON.stringify(body));
  return { "uuid": entry };
}
