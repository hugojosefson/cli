import { test as nativeTest } from "node:test";
import { assertEquals, assertRejects } from "@std/assert";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
import { publishJsr } from "./publish-jsr.ts";
import type { PublisherFiles } from "./publisher-input.ts";
import {
  encoder,
  environment,
  files,
  process,
  remote,
  sha,
} from "./publisher-test-fixtures.ts";

const test = trackTests(import.meta.url, nativeTest);
const packageConfig = (hj: unknown, overrides = {}) =>
  JSON.stringify({
    name: "@owner/repo",
    version: "1.2.3",
    exports: "./mod.ts",
    hj,
    tasks: {
      "publish-check": "deno publish --allow-dirty --allow-slow-types",
    },
    ...overrides,
  });
const packageFiles = { read: () => Promise.resolve(encoder.encode("x")) };

for (const configPath of ["deno.json", "deno.jsonc"] as const) {
  test(`JSR publication reads slow types from ${configPath}`, async () => {
    for (
      const hj of [undefined, {}, { jsr: {} }, {
        commandName: "example",
        jsr: { allowSlowTypes: false },
      }, { jsr: { allowSlowTypes: true } }]
    ) {
      const calls: string[] = [];
      const versions = [undefined, remote()];
      const provenance: unknown[] = [];
      const config: PublisherFiles = {
        observe: (path) =>
          Promise.resolve(
            path === configPath
              ? {
                kind: "file",
                bytes: encoder.encode(
                  `// Package settings\n${packageConfig(hj)}`,
                ),
              }
              : { kind: "absent" },
          ),
      };
      await publishJsr({
        environment: environment(),
        process: process(calls),
        files: config,
        packageFiles,
        api: {
          version: () => Promise.resolve(versions.shift()),
          verifyProvenance: (input) => {
            provenance.push(input);
            return Promise.resolve();
          },
        },
      });
      const suffix = hj?.jsr?.allowSlowTypes ? " --allow-slow-types" : "";
      assertEquals(calls.slice(-2), [
        `deno publish --dry-run${suffix}`,
        `deno publish${suffix}`,
      ]);
      assertEquals(provenance, [{
        packageName: "@owner/repo",
        version: "1.2.3",
        sha,
        manifestDigest: remote().manifestDigest,
        rekorLogId: remote().rekorLogId,
        repository: "owner/repo",
      }]);
    }
  });
}

test("JSR rejects invalid slow-type settings before registry access", async () => {
  const invalid = [null, false, "true", 0, [], {}];
  const cases = [
    ...invalid.filter((value) => value !== false).map((allowSlowTypes) => ({
      hj: { jsr: { allowSlowTypes } },
      error: "hj.jsr.allowSlowTypes must be a boolean.",
    })),
    ...invalid.slice(0, -1).map((jsr) => ({
      hj: { jsr },
      error: "hj.jsr must be an object.",
    })),
    ...invalid.slice(0, -1).map((hj) => ({
      hj,
      error: "hj must be an object.",
    })),
  ];
  for (const { hj, error } of cases) {
    const calls: string[] = [];
    await assertRejects(
      () =>
        publishJsr({
          environment: environment(),
          process: process(calls),
          files: files(packageConfig(hj)),
          packageFiles,
          api: {
            version: () => {
              calls.push("registry");
              return Promise.resolve(remote());
            },
            verifyProvenance: () => Promise.resolve(),
          },
        }),
      TypeError,
      error,
    );
    assertEquals(calls.some((call) => call.startsWith("deno ")), false);
    assertEquals(calls.includes("registry"), false);
  }
});

test("JSR slow types keep checkout, release, and provenance checks", async () => {
  const hj = { jsr: { allowSlowTypes: true } };
  const cases: {
    output?: Record<string, string>;
    config?: Record<string, unknown>;
    environment?: Record<string, string>;
    error: string;
  }[] = [
    {
      output: {
        "git status --porcelain=v1 --untracked-files=normal": " M mod.ts\n",
      },
      error: "clean release checkout",
    },
    { config: { name: "@other/repo" }, error: "name or version differs" },
    { config: { version: "2.0.0" }, error: "config version differs" },
    {
      output: { "git rev-parse HEAD^{commit}": "b".repeat(40) },
      error: "Checkout HEAD differs",
    },
    {
      environment: { GITHUB_SHA: "b".repeat(40) },
      error: "Workflow commit differs",
    },
  ];
  for (const entry of cases) {
    const calls: string[] = [];
    await assertRejects(
      () =>
        publishJsr({
          environment: environment(entry.environment),
          process: process(calls, entry.output),
          files: files(packageConfig(hj, entry.config)),
          packageFiles,
          api: {
            version: () => Promise.resolve(undefined),
            verifyProvenance: () => Promise.resolve(),
          },
        }),
      TypeError,
      entry.error,
    );
    assertEquals(calls.some((call) => call.startsWith("deno ")), false);
  }
  for (const existing of [false, true]) {
    const versions = existing ? [remote()] : [undefined, remote()];
    await assertRejects(
      () =>
        publishJsr({
          environment: environment(),
          process: process([]),
          files: files(packageConfig(hj)),
          packageFiles,
          api: {
            version: () => Promise.resolve(versions.shift()),
            verifyProvenance: () =>
              Promise.reject(new TypeError("provenance differs")),
          },
        }),
      TypeError,
      "provenance differs",
    );
  }
});
