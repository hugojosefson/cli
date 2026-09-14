import { test as nativeTest } from "node:test";
import { trackTests } from "../../src/testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import { assertEquals, assertThrows } from "@std/assert";
import {
  type DenoLock,
  dependencyOverrides,
  mappedDependencies,
  npmIdentity,
} from "./manifest.ts";
import { verifyNativeLock } from "./verify-lock.ts";

const source: DenoLock = {
  specifiers: { "npm:library@3.0.0": "3.0.0", "jsr:@std/path@^2.0.0": "2.1.0" },
  npm: {
    "library@3.0.0": { integrity: "library", dependencies: ["child@2.0.0"] },
    "other@1.0.0": { integrity: "other", dependencies: ["child@1.0.0"] },
    "child@2.0.0": { integrity: "child2" },
    "child@1.0.0": { integrity: "child1" },
  },
  jsr: { "@std/path@2.1.0": {} },
};

test("native dependencies use selected Deno versions", () => {
  assertEquals(
    mappedDependencies(
      { library: "2.0.0", "@jsr/std__path": "1.0.0", tool: "1.0.0" },
      { library: "npm:library@3.0.0", "@std/path": "jsr:@std/path@^2.0.0" },
      source,
    ),
    { library: "3.0.0", "@jsr/std__path": "2.1.0", tool: "1.0.0" },
  );
  assertThrows(
    () =>
      mappedDependencies(
        { library: "1.0.0" },
        { library: "npm:library@4.0.0" },
        source,
      ),
    Error,
    "No locked version",
  );
});

test("native overrides keep different dependency versions", () => {
  assertEquals(
    dependencyOverrides({ library: "3.0.0", other: "1.0.0" }, source),
    { "library@3.0.0": { child: "2.0.0" }, "other@1.0.0": { child: "1.0.0" } },
  );
  assertEquals(dependencyOverrides({ library: "3.0.0" }, source), {
    "library@3.0.0": { child: "2.0.0" },
  });
});

test("native locks reject changed versions and integrity values", () => {
  const packages = {
    "node_modules/library": { version: "3.0.0", integrity: "library" },
    "node_modules/@jsr/std__path": { version: "2.1.0" },
  };
  verifyNativeLock(source, packages, true);
  assertThrows(
    () =>
      verifyNativeLock(source, {
        "node_modules/library": { version: "3.0.0", integrity: "changed" },
      }, true),
    Error,
    "differs from deno.lock",
  );
  assertThrows(
    () =>
      verifyNativeLock(source, {
        "node_modules/library": { version: "4.0.0", integrity: "library" },
      }, false),
    Error,
    "differs from deno.lock",
  );
  assertThrows(
    () =>
      verifyNativeLock(source, {
        "node_modules/@jsr/std__path": { version: "1.0.0" },
      }, false),
    Error,
    "differs from deno.lock",
  );
  verifyNativeLock(source, {
    "node_modules/tool": { version: "1.0.0", integrity: "tool" },
  }, false);
  assertThrows(
    () =>
      verifyNativeLock(source, {
        "node_modules/tool": { version: "1.0.0", integrity: "tool" },
      }, true),
    Error,
    "differs from deno.lock",
  );
});

test("npm version responses contain one version number", async () => {
  const { latestVersion } = await import("./latest-version.ts");
  assertEquals(latestVersion('"3.0.0"'), "3.0.0");
  assertEquals(latestVersion('["3.0.0"]'), "3.0.0");
  for (const invalid of ["[]", '["1.0.0", "2.0.0"]', "null", '"latest"']) {
    assertThrows(() => latestVersion(invalid), Error, "one version number");
  }
});

test("npm tool locks use approved registry hosts", async () => {
  const { verifyRegistryLock } = await import("./registry-lock.ts");
  verifyRegistryLock({
    "": {},
    "node_modules/library": {
      resolved: "https://registry.npmjs.org/library/-/library-1.0.0.tgz",
    },
    "node_modules/@jsr/std__path": { resolved: "https://npm.jsr.io/path.tgz" },
    "node_modules/npm/node_modules/library": { inBundle: true },
  });
  for (
    const resolved of [
      "https://example.com/library.tgz",
      "http://registry.npmjs.org/library.tgz",
      "https://user:dummy@registry.npmjs.org/library.tgz",
      undefined,
    ]
  ) {
    assertThrows(
      () => verifyRegistryLock({ "node_modules/library": { resolved } }),
      Error,
      "approved registry URL",
    );
  }
});

test("npm identities keep underscores in package names", () => {
  assertEquals(npmIdentity("@scope/with_under@1.2.3_peer@2.0.0"), [
    "@scope/with_under",
    "1.2.3",
  ]);
});
