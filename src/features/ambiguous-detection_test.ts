import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import type { ArtifactObservation } from "../api/artifact-inspection.ts";
import type { DetectionContext } from "../api/repository-context.ts";
import { builtInFeatureRegistry } from "./built-in-feature-registry.ts";
import { formatFeatureStatus } from "../cli/format-features.ts";
import { legacyGithubCiArtifacts } from "./github-ci-legacy.ts";
import { denoTaskDefinitions } from "./deno-tasks.ts";

const test = trackTests(import.meta.url, nativeTest);

test("all built-in features explain expected and observed states for unsafe paths or unavailable GitHub data", async () => {
  const current = context({}, { kind: "symlink", target: "private-target" });
  const detections = new Map();
  for (const feature of builtInFeatureRegistry.features) {
    const result = await feature.detect(current);
    detections.set(feature.metadata.id, result);
    if (result.state !== "ambiguous") continue;
    assert(result.issues.length > 0, feature.metadata.id);
    for (const issue of result.issues) {
      assert(
        /expected/i.test(issue.observation),
        `${feature.metadata.id}: ${issue.observation}`,
      );
      assert(
        /found/i.test(issue.observation),
        `${feature.metadata.id}: ${issue.observation}`,
      );
    }
  }
  assert(
    [...detections.values()].filter((result) => result.state === "ambiguous")
      .length > 40,
  );
  const output = formatFeatureStatus(builtInFeatureRegistry, detections);
  assert(
    !output.includes(
      "Repair is blocked until the ambiguous state is resolved manually.",
    ),
  );
  assert(!output.includes("private-target"));
});

test("Deno diagnostics distinguish each wrong task type without exposing command strings", async () => {
  for (const value of [null, [], 42, false, "private-command"]) {
    const config = {
      tasks: value,
      exports: { "./server": "./src/server/server.ts" },
    };
    const current = context({ "deno.json": file(JSON.stringify(config)) });
    for (
      const id of [
        "deno-fmt",
        "deno-lint",
        "deno-test",
        "deno-typecheck",
        "jsr-package",
      ]
    ) {
      const result = await feature(id).detect(current);
      assertEquals(result.state, "ambiguous", id);
      assertStringIncludes(
        JSON.stringify(result),
        "deno.json tasks: expected an object.",
      );
      assert(!JSON.stringify(result).includes("private-command"));
    }
  }
  const tasks = { ...denoTaskDefinitions(), fmt: 42, default: false };
  const result = await feature("deno-fmt").detect(
    context({ "deno.jsonc": file(JSON.stringify({ tasks })) }),
  );
  assertStringIncludes(JSON.stringify(result), "tasks.fmt");
  assertStringIncludes(JSON.stringify(result), "Found 42");
  assertStringIncludes(JSON.stringify(result), "tasks.default");
  assertStringIncludes(JSON.stringify(result), "Found false");
});

test("workflow conflicts identify the actual path and absent ownership marker", async () => {
  const path = ".github/workflows/hj-release-publish-github.yaml";
  const result = await feature("github-release-publish-github").detect(
    context({ [path]: file("name: custom\n") }),
  );
  if (result.state !== "ambiguous") {
    throw new Error("expected workflow conflict");
  }
  assertEquals(result.issues[0].subject.identifier, path);
  assertStringIncludes(result.issues[0].observation, "expected the prefix");
  assertStringIncludes(
    result.issues[0].observation,
    "Found a file without that prefix",
  );
});

test("EditorConfig diagnostics identify the invalid source line and ownership field", async () => {
  const invalid = await feature("editorconfig").detect(
    context({ ".editorconfig": file("root = true\n\nnot an entry\n") }),
  );
  assertStringIncludes(JSON.stringify(invalid), ".editorconfig:3");
  assertStringIncludes(
    JSON.stringify(invalid),
    "without a section marker or equals sign",
  );
  const ownership = await feature("editorconfig").detect(
    context({
      ".hj/editorconfig.json": file(
        JSON.stringify({ version: 2, keys: [], heading: true, section: true }),
      ),
    }),
  );
  assertStringIncludes(JSON.stringify(ownership), "version=1");
  assertStringIncludes(JSON.stringify(ownership), "version=2");
});

function feature(id: string) {
  return builtInFeatureRegistry.features.find((feature) =>
    feature.metadata.id === id
  )!;
}
function file(content: string): ArtifactObservation {
  return { kind: "file", content, mode: 0o644, digest: "digest" };
}
function context(
  entries: Record<string, ArtifactObservation>,
  fallback: ArtifactObservation = { kind: "absent" },
): DetectionContext {
  return {
    repositoryRoot: new URL("file:///tmp/opencode/diagnostic-fixture/"),
    files: {
      observe: (path) => Promise.resolve(entries[path] ?? fallback),
      exists: (path) => Promise.resolve(path in entries),
      readText: (path) => {
        const file = entries[path];
        return Promise.resolve(
          file?.kind === "file" ? file.content : undefined,
        );
      },
      readJson: () => Promise.resolve(undefined),
      digest: () => Promise.resolve(undefined),
      directoryStateDigest: () => Promise.resolve(undefined),
      mode: () => Promise.resolve(undefined),
    },
    git: {
      isRepository: () => Promise.resolve(false),
      head: () => Promise.resolve(undefined),
      status: () => Promise.resolve(undefined),
      defaultBranch: () => Promise.resolve(undefined),
      remotes: () =>
        Promise.resolve([{
          name: "origin",
          url: "https://github.com/example/repo.git",
        }]),
    },
  };
}

test("package identity conflicts identify the actual version range and unscoped name", async () => {
  const current = context({
    "deno.json": file(JSON.stringify({ name: "unscoped", version: "^1.2.3" })),
  });
  const version = await feature("deno-config-version").detect(current);
  assertStringIncludes(
    JSON.stringify(version),
    "version: expected an exact SemVer",
  );
  assertStringIncludes(JSON.stringify(version), "^1.2.3");
  const name = await feature("jsr-package").detect(current);
  assertStringIncludes(JSON.stringify(name), "@scope/package");
  assertStringIncludes(JSON.stringify(name), "unscoped");
});

test("custom dependency workflows name the actual job that differs", async () => {
  const artifact = legacyGithubCiArtifacts[1];
  const result = await feature("github-ci").detect(context({
    [artifact.path]: file(artifact.content.replace("  molt:", "  bump-deps:")),
  }));
  assertEquals(result.state, "ambiguous");
  if (result.state !== "ambiguous") throw new Error("expected conflict");
  assertStringIncludes(result.issues[0].observation, 'expected "  molt:"');
  assertStringIncludes(result.issues[0].observation, 'Found "  bump-deps:"');
});
