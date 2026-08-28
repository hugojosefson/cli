import { assertEquals } from "@std/assert";
import type { Feature } from "../api/feature.ts";
import type { FeatureRegistry } from "./feature-registry.ts";
import { validateFeatureRegistry } from "./validate-feature-registry.ts";
import { builtInFeatureRegistry } from "./built-in-feature-registry.ts";

Deno.test("the complete built-in registry validates", () => {
  assertEquals(validateFeatureRegistry(builtInFeatureRegistry), []);
  assertEquals(
    builtInFeatureRegistry.features.map((feature) => feature.metadata.id),
    [
      "deno-cli",
      "deno-fmt",
      "deno-lint",
      "deno-typecheck",
      "deno-test",
      "deno-lib",
      "deno-server",
      "git",
      "github-repo",
      "jsr-package",
      "jsr-release",
      "github-ci",
      "github-main-protection",
      "github-main-review",
      "github-protected-tags",
      "github-auto-merge",
      "github-delete-branch-on-merge",
      "github-merge-commit",
      "github-squash-merge",
      "github-rebase-merge",
      "github-wiki",
      "github-issues",
      "github-projects",
      "github-discussions",
      "github-update-branch",
      "github-web-commit-signoff",
      "github-private",
      "license-mit",
      "license-apache-2.0",
      "license-gpl-2.0-only",
      "license-gpl-3.0-only",
      "license-agpl-3.0-only",
      "license-isc",
      "license-bsd-2-clause",
      "license-bsd-3-clause",
      "license-mpl-2.0",
      "license-unlicense",
      "license-cc0-1.0",
      "license-cc-by-4.0",
      "license-cc-by-sa-4.0",
      "license-cc-by-nd-4.0",
      "license-cc-by-nc-4.0",
      "license-cc-by-nc-sa-4.0",
      "license-cc-by-nc-nd-4.0",
      "readme-static",
      "readme-build",
    ],
  );
  assertEquals(
    builtInFeatureRegistry.capabilities,
    [{ id: "deno-export", providerPolicy: "multiple" }, {
      id: "license",
      providerPolicy: "exclusive",
      defaultProvider: "license-mit",
    }, {
      id: "readme",
      providerPolicy: "exclusive",
      defaultProvider: "readme-static",
    }],
  );
});

function feature(
  id: string,
  dependencies: readonly string[] = [],
  provides: readonly string[] = [],
  requires: readonly string[] = [],
): Feature {
  return {
    metadata: { id, name: id, summary: id },
    dependencies: {
      requires: dependencies.map((featureId) => ({
        featureId,
        reason: "test",
      })),
    },
    capabilities: {
      provides,
      requires: requires.map((capabilityId) => ({
        capabilityId,
        reason: "test",
      })),
    },
    detect: () => Promise.resolve({ state: "disabled", evidence: [] }),
    checkEnable: () =>
      Promise.resolve({
        result: "no-op",
        reason: "test",
        warnings: [],
      }),
    planEnable: () =>
      Promise.resolve({
        featureId: id,
        action: "enable",
        summary: "test",
        warnings: [],
        preconditions: [],
        changes: [],
        validations: [],
      }),
    checkDisable: () =>
      Promise.resolve({
        result: "no-op",
        reason: "test",
        warnings: [],
      }),
    planDisable: () =>
      Promise.resolve({
        featureId: id,
        action: "disable",
        summary: "test",
        warnings: [],
        preconditions: [],
        changes: [],
        validations: [],
      }),
  };
}

function codes(registry: FeatureRegistry): readonly string[] {
  return validateFeatureRegistry(registry).map((issue) => issue.code);
}

Deno.test("validates duplicate IDs, references, and cycles deterministically", () => {
  const result = validateFeatureRegistry({
    features: [
      feature("b", ["missing", "c"], ["missing-cap"], ["also-missing"]),
      feature("c", ["b"]),
      feature("a"),
      feature("a"),
    ],
    capabilities: [{ id: "cap", providerPolicy: "multiple" }, {
      id: "cap",
      providerPolicy: "multiple",
    }],
  });
  assertEquals(result, [
    { code: "duplicate-feature-id", featureId: "a" },
    { code: "duplicate-capability-id", capabilityId: "cap" },
    { code: "unknown-direct-dependency", featureId: "b", relatedId: "missing" },
    {
      code: "unknown-provided-capability",
      featureId: "b",
      capabilityId: "missing-cap",
    },
    {
      code: "unknown-required-capability",
      featureId: "b",
      capabilityId: "also-missing",
    },
    { code: "dependency-cycle", featureId: "b" },
    { code: "dependency-cycle", featureId: "c" },
  ]);
});

Deno.test("validates default providers and exclusive provider setup", () => {
  assertEquals(
    codes({
      features: [feature("one"), feature("two")],
      capabilities: [
        {
          id: "absent",
          providerPolicy: "multiple",
          defaultProvider: "missing",
        },
        { id: "wrong", providerPolicy: "multiple", defaultProvider: "two" },
        { id: "none", providerPolicy: "exclusive" },
      ],
    }),
    [
      "invalid-default-provider",
      "invalid-exclusive-provider-setup",
      "default-provider-does-not-provide-capability",
    ],
  );
});

Deno.test("detects cycles through a capability default provider", () => {
  assertEquals(
    validateFeatureRegistry({
      features: [
        feature("consumer", [], [], ["service"]),
        feature("provider", ["consumer"], ["service"]),
      ],
      capabilities: [{
        id: "service",
        providerPolicy: "exclusive",
        defaultProvider: "provider",
      }],
    }).filter((issue) => issue.code === "dependency-cycle"),
    [
      { code: "dependency-cycle", featureId: "consumer" },
      { code: "dependency-cycle", featureId: "provider" },
    ],
  );
});

Deno.test("validates preset IDs and targets", () => {
  assertEquals(
    validateFeatureRegistry({
      features: [feature("app")],
      capabilities: [{ id: "cap", providerPolicy: "multiple" }],
      presets: [{
        id: "app",
        name: "App",
        summary: "Test preset.",
        changes: [{ featureId: "missing", enabled: true }, {
          featureId: "missing",
          enabled: false,
        }],
      }, {
        id: "cap",
        name: "Cap",
        summary: "Test preset.",
        changes: [],
      }, {
        id: "cap",
        name: "Cap duplicate",
        summary: "Test preset.",
        changes: [],
      }],
    }).map((issue) => issue.code),
    [
      "duplicate-preset-id",
      "preset-id-collides-with-feature-id",
      "unknown-preset-target-feature",
      "unknown-preset-target-feature",
      "contradictory-preset-target",
      "preset-id-collides-with-capability-id",
      "preset-id-collides-with-capability-id",
    ],
  );
});
