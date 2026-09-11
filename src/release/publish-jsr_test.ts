import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  type JsrApi,
  jsrHttpApi,
  jsrPackageName,
  type JsrVersion,
  localPackageFiles,
  publishJsr,
} from "./publish-jsr.ts";
import {
  checksum,
  createGitSymlink,
  encoder,
  environment,
  files,
  ok,
  process,
  rekor,
  remote,
  sha,
} from "./publisher-test-fixtures.ts";

const input = {
  packageName: "@owner/repo",
  version: "1.2.3",
  sha,
  route: "event" as const,
  rekorLogId: 7,
  repository: "owner/repo",
};
const object = (value: unknown) => value as Record<string, unknown>;
const nested = (value: unknown, ...keys: string[]) =>
  keys.reduce((x, key) => object(x[key]), object(value));
Deno.test("Rekor v1 fixture accepts exact data and rejects every release-bound group", async () => {
  const verify = (value: unknown) =>
    jsrHttpApi(() =>
      Promise.resolve({ status: 200, json: () => Promise.resolve(value) })
    ).verifyProvenance(input);
  await verify(await rekor());
  const mutations: Array<
    (
      s: Record<string, unknown>,
      e: Record<string, unknown>,
      b: Record<string, unknown>,
    ) => void
  > = [
    (s) => s.type = "x",
    (s) => s.predicateType = "x",
    (s) => s.subject = [],
    (s) => s.subject = [object((s.subject as unknown[])[0]), {}],
    (s) => object((s.subject as unknown[])[0]).name = "x",
    (s) =>
      object((s.subject as unknown[])[0]).digest = {
        sha256: "x".repeat(64),
        extra: "x",
      },
    (s) => nested(s, "predicate", "buildDefinition").buildType = "x",
    (s) =>
      nested(
        s,
        "predicate",
        "buildDefinition",
        "externalParameters",
        "workflow",
      ).repository = "x",
    (s) =>
      nested(
        s,
        "predicate",
        "buildDefinition",
        "externalParameters",
        "workflow",
      ).path = "x",
    (s) =>
      nested(
        s,
        "predicate",
        "buildDefinition",
        "externalParameters",
        "workflow",
      ).ref = "x",
    (s) =>
      nested(s, "predicate", "buildDefinition", "internalParameters", "github")
        .eventName = "x",
    (s) =>
      nested(s, "predicate", "buildDefinition", "internalParameters", "github")
        .repositoryId = "0",
    (s) =>
      nested(s, "predicate", "buildDefinition", "internalParameters", "github")
        .repositoryOwnerId = "0",
    (s) =>
      object(
        (nested(s, "predicate", "buildDefinition")
          .resolvedDependencies as unknown[])[0],
      ).uri = "x",
    (s) =>
      object(
        object(
          (nested(s, "predicate", "buildDefinition")
            .resolvedDependencies as unknown[])[0],
        ).digest,
      ).gitCommit = "b".repeat(40),
    (s) => nested(s, "predicate", "runDetails", "builder").id = "x",
    (s) => nested(s, "predicate", "runDetails", "metadata").invocationId = "x",
    (_s, e) => e.verification = {},
    (_s, e) => e.verification = { inclusionProof: {} },
    (_s, e) => e.verification = { signedEntryTimestamp: btoa("stamp") },
    (_s, e) => e.logID = "x",
    (_s, _e, b) => b.apiVersion = "x",
    (_s, _e, b) => b.kind = "x",
    (_s, _e, b) => b.spec = {},
    (_s, _e, b) =>
      nested(b, "spec", "content").payloadHash = {
        algorithm: "sha256",
        value: "0".repeat(64),
      },
    (_s, _e, b) =>
      nested(b, "spec", "content").hash = {
        algorithm: "sha512",
        value: "f".repeat(64),
      },
    (_s, _e, b) =>
      nested(b, "spec", "content").envelope = {
        payloadType: "application/vnd.in-toto+json",
        signatures: [],
      },
    (_s, _e, b) => nested(b, "spec", "content", "envelope").payloadType = "x",
    (_s, _e, b) =>
      nested(b, "spec", "content", "envelope").signatures = [{ sig: "" }],
    (_s, _e, b) =>
      nested(b, "spec", "content", "envelope").signatures = [{
        publicKey: btoa("public key"),
        sig: "not base64",
      }],
    (_s, _e, b) =>
      nested(b, "spec", "content", "envelope").signatures = [{
        publicKey: "",
        sig: btoa("signature"),
      }],
    (_s, e) => nested(e, "verification", "inclusionProof").logIndex = -1,
    (_s, e) => nested(e, "verification", "inclusionProof").treeSize = 0,
    (_s, e) =>
      nested(e, "verification", "inclusionProof").rootHash = "X".repeat(64),
    (_s, e) =>
      nested(e, "verification", "inclusionProof").hashes = ["X".repeat(64)],
    (_s, e) => nested(e, "verification", "inclusionProof").checkpoint = "",
    (_s, e) =>
      e.verification = {
        inclusionProof: {
          logIndex: 7,
          treeSize: 8,
          rootHash: "d".repeat(64),
          hashes: ["e".repeat(64)],
          checkpoint: "rekor checkpoint",
        },
        signedEntryTimestamp: "not base64",
      },
  ];
  for (const mutate of mutations) {
    await assertRejects(() => rekor(mutate).then(verify), TypeError);
  }
  await assertRejects(() => verify({}), TypeError);
  const fixture = object(await rekor()).uuid;
  await assertRejects(
    () => verify({ first: fixture, second: fixture }),
    TypeError,
  );
  const entry = object(await rekor()).uuid as Record<string, unknown>;
  await assertRejects(
    () => verify({ uuid: { ...entry, attestation: { data: "not base64" } } }),
    TypeError,
  );
});
Deno.test("JSR HTTP status and metadata validation are fail-closed", async () => {
  const management = {
    scope: "owner",
    package: "repo",
    version: "1.2.3",
    yanked: false,
    rekorLogId: 7,
  };
  assertEquals(
    await jsrHttpApi(() =>
      Promise.resolve({ status: 404, json: () => Promise.resolve({}) })
    ).version("@owner/repo", "1.2.3"),
    undefined,
  );
  for (const status of [400, 500]) {
    await assertRejects(() =>
      jsrHttpApi(() =>
        Promise.resolve({ status, json: () => Promise.resolve({}) })
      ).version("@owner/repo", "1.2.3")
    );
  }
  for (
    const value of [
      {},
      { ...management, yanked: true },
      { ...management, rekorLogId: null },
      { ...management, package: "other" },
    ]
  ) {
    await assertRejects(() =>
      jsrHttpApi(() =>
        Promise.resolve({ status: 200, json: () => Promise.resolve(value) })
      ).version("@owner/repo", "1.2.3")
    );
  }
  for (
    const registry of [{}, { manifest: {}, moduleGraph2: {}, exports: {} }, {
      manifest: { "/x": { size: -1, checksum } },
      moduleGraph2: {},
      exports: { ".": "./x" },
    }]
  ) {
    await assertRejects(() =>
      jsrHttpApi((url) =>
        Promise.resolve({
          status: 200,
          json: () =>
            Promise.resolve(url.includes("api.jsr") ? management : registry),
        })
      ).version("@owner/repo", "1.2.3"), TypeError);
  }
  let request = 0;
  await assertRejects(() =>
    jsrHttpApi(() => {
      request++;
      return Promise.resolve({
        status: request === 1 ? 200 : 404,
        json: () => Promise.resolve(management),
      });
    }).version("@owner/repo", "1.2.3"), Error);
  const urls: string[] = [];
  assertEquals(
    await jsrHttpApi((url) => {
      urls.push(url);
      return Promise.resolve({
        status: 200,
        json: () =>
          Promise.resolve(url.includes("api.jsr") ? management : remote()),
      });
    }).version("@owner/repo", "1.2.3"),
    remote(),
  );
  assertEquals(urls, [
    "https://api.jsr.io/scopes/owner/packages/repo/versions/1.2.3",
    "https://jsr.io/@owner/repo/1.2.3_meta.json",
  ]);
});
Deno.test("JSR existing versions require exact exports, files, graph, and provenance", async () => {
  const packageFiles = { read: () => Promise.resolve(encoder.encode("x")) };
  const exactCalls: string[] = [];
  await publishJsr({
    environment: environment(),
    process: process(exactCalls),
    files: files(),
    packageFiles,
    api: {
      version: () => Promise.resolve(remote()),
      verifyProvenance: () => Promise.resolve(),
    },
  });
  assertEquals(exactCalls, [
    "git ls-remote origin refs/tags/1.2.3 refs/tags/1.2.3^{}",
    "git rev-parse HEAD^{commit}",
  ]);
  const conflicts: readonly JsrVersion[] = [
    { ...remote(), exports: { ".": "./other.ts" } },
    { ...remote(), moduleGraph2: {} },
    { ...remote(), manifest: {} },
    {
      ...remote(),
      manifest: {
        "/mod.ts": { size: 1, checksum },
        "/README.md": { size: 1, checksum: `sha256-${"0".repeat(64)}` },
      },
    },
  ];
  for (const version of conflicts) {
    await assertRejects(() =>
      publishJsr({
        environment: environment(),
        process: process([]),
        files: files(),
        packageFiles,
        api: {
          version: () => Promise.resolve(version),
          verifyProvenance: () => Promise.resolve(),
        },
      }), TypeError);
  }
  await assertRejects(() =>
    publishJsr({
      environment: environment(),
      process: process([]),
      files: files(),
      packageFiles,
      api: {
        version: () => Promise.resolve(remote()),
        verifyProvenance: () => Promise.reject(new TypeError("drift")),
      },
    }), TypeError);
});
Deno.test("JSR publish retries transient uncertainty, confirms failed publish, and bounds polling", async () => {
  const packageFiles = { read: () => Promise.resolve(encoder.encode("x")) };
  const api = (
    values: Array<
      ReturnType<JsrApi["version"]> extends Promise<infer T> ? T : never
    >,
  ): JsrApi => ({
    version: () => Promise.resolve(values.shift()),
    verifyProvenance: () => Promise.resolve(),
  });
  const calls: string[] = [];
  const base = process(calls);
  await publishJsr({
    environment: environment(),
    files: files(),
    packageFiles,
    api: api([undefined, remote()]),
    process: {
      run: (c, a, o) =>
        c === "deno" && a[1] === undefined
          ? (calls.push(`${c} ${a.join(" ")}`),
            Promise.resolve({ ...ok(), success: false, code: 1 }))
          : base.run(c, a, o),
    },
  });
  assertEquals(calls.slice(-2), ["deno publish --dry-run", "deno publish"]);
  let transientReads = 0;
  let transientProvenance = 0;
  const transientWaits: number[] = [];
  await publishJsr({
    environment: environment(),
    process: process([]),
    files: files(),
    packageFiles,
    api: {
      version: () => {
        transientReads++;
        if (transientReads === 1) return Promise.resolve(undefined);
        if (transientReads === 2) return Promise.reject(new Error("retry"));
        return Promise.resolve(remote());
      },
      verifyProvenance: () => {
        transientProvenance++;
        return transientProvenance === 1
          ? Promise.reject(new Error("retry"))
          : Promise.resolve();
      },
    },
    clock: {
      sleep: (ms) => {
        transientWaits.push(ms);
        return Promise.resolve();
      },
    },
  });
  assertEquals(transientWaits, [5000, 5000]);
  await assertRejects(() =>
    publishJsr({
      environment: environment(),
      process: process([]),
      files: files(),
      packageFiles,
      api: {
        version: (() => {
          let read = 0;
          return () => Promise.resolve(read++ === 0 ? undefined : remote());
        })(),
        verifyProvenance: () => Promise.reject(new TypeError("drift")),
      },
      clock: { sleep: () => Promise.resolve() },
    }), TypeError);
  const waits: number[] = [];
  await assertRejects(() =>
    publishJsr({
      environment: environment(),
      process: process([]),
      files: files(),
      packageFiles,
      api: api(Array(14).fill(undefined)),
      clock: {
        sleep: (ms) => {
          waits.push(ms);
          return Promise.resolve();
        },
      },
    }), Error);
  assertEquals(waits, Array(12).fill(5000));
  const dryRunCalls: string[] = [];
  const dryRunProcess = process(dryRunCalls);
  await assertRejects(() =>
    publishJsr({
      environment: environment(),
      files: files(),
      packageFiles,
      api: api([undefined]),
      process: {
        run: (command, args, options) =>
          command === "deno" && args[1] === "--dry-run"
            ? Promise.resolve({ ...ok(), success: false, code: 1 })
            : dryRunProcess.run(command, args, options),
      },
    }), Error);
  assertEquals(dryRunCalls.includes("deno publish"), false);
  assertEquals(jsrPackageName("Owner-1/Repo-2"), "@owner-1/repo-2");
  assertThrows(() => jsrPackageName("owner/repo_name"), TypeError);
});
Deno.test("local package reader rejects unsafe paths, directories, and symlinks", async () => {
  const root = await Deno.makeTempDir({
    dir: "/tmp/opencode",
    prefix: "package-",
  });
  try {
    await Deno.mkdir(`${root}/dir`);
    await Deno.writeTextFile(`${root}/file.ts`, "x");
    await createGitSymlink(new URL(`file://${root}/`), "link.ts", "file.ts");
    const reader = localPackageFiles(new URL(`file://${root}/`));
    for (const path of ["../file.ts", "/file.ts", "dir", "link.ts"]) {
      await assertRejects(() => reader.read(path), TypeError);
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
