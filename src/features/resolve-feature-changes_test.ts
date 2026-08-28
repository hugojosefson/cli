import { assertEquals } from "@std/assert";
import type { Feature } from "../api/feature.ts";
import type { FeatureChangeRequest } from "../api/feature-change.ts";
import type { FeatureDetection } from "../api/feature-detection.ts";
import type { FeatureRegistry } from "./feature-registry.ts";
import { resolveFeatureChanges } from "./resolve-feature-changes.ts";

function feature(
  id: string,
  options: {
    readonly dependencies?: readonly string[];
    readonly provides?: readonly string[];
    readonly requires?: readonly string[];
  } = {},
): Feature {
  return {
    metadata: { id, name: id, summary: id },
    dependencies: {
      requires: (options.dependencies ?? []).map((featureId) => ({
        featureId,
        reason: `${id} needs ${featureId}`,
      })),
    },
    capabilities: {
      provides: options.provides ?? [],
      requires: (options.requires ?? []).map((capabilityId) => ({
        capabilityId,
        reason: `${id} needs ${capabilityId}`,
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

function registry(
  features: readonly Feature[],
  capabilities: FeatureRegistry["capabilities"] = [],
  presets: NonNullable<FeatureRegistry["presets"]> = [],
): FeatureRegistry {
  return { features, capabilities, presets };
}

function request(
  changes: FeatureChangeRequest["changes"] = [],
  applyDefaults = false,
  defaults: FeatureChangeRequest["defaults"] = [],
): FeatureChangeRequest {
  return { changes, presets: [], applyDefaults, defaults };
}

function detections(
  states: Readonly<Record<string, FeatureDetection["state"]>>,
): Readonly<Record<string, FeatureDetection>> {
  return Object.fromEntries(
    Object.entries(states).map((
      [id, state],
    ) => [
      id,
      state === "drifted" || state === "ambiguous"
        ? { state, evidence: [], issues: [] }
        : { state, evidence: [] },
    ]),
  ) as Readonly<Record<string, FeatureDetection>>;
}

Deno.test("status-only does not select defaults", () => {
  const result = resolveFeatureChanges(
    registry([feature("git")]),
    detections({ git: "disabled" }),
    request([], false, [{ kind: "feature", featureId: "git" }]),
  );
  assertEquals(result, { changes: [], issues: [] });
});

Deno.test("defaults select fallback features and configured capabilities", () => {
  const features = [
    feature("git"),
    feature("readme", { provides: ["readme"] }),
  ];
  assertEquals(
    resolveFeatureChanges(
      registry(features, [{
        id: "readme",
        providerPolicy: "multiple",
        defaultProvider: "readme",
      }]),
      detections({ git: "disabled", readme: "disabled" }),
      request([], true, [{ kind: "feature", featureId: "git" }, {
        kind: "capability",
        capabilityId: "readme",
      }]),
    ).changes.map((change) => change.featureId),
    ["git", "readme"],
  );
});

Deno.test("explicit changes override defaults", () => {
  const result = resolveFeatureChanges(
    registry([feature("git")]),
    detections({ git: "disabled" }),
    request([{ featureId: "git", enabled: false }], true, [{
      kind: "feature",
      featureId: "git",
    }]),
  );
  assertEquals(result.changes, []);
});

Deno.test("explicit changes override presets regardless of request order", () => {
  const presets = [{
    id: "base",
    name: "Base",
    summary: "Test preset.",
    changes: [{ featureId: "git", enabled: true }],
  }];
  for (
    const changes of [[{ featureId: "git", enabled: false }], [{
      featureId: "git",
      enabled: false,
    }]]
  ) {
    assertEquals(
      resolveFeatureChanges(
        registry([feature("git")], [], presets),
        detections({ git: "disabled" }),
        { ...request(changes), presets: ["base"] },
      ),
      { changes: [], issues: [] },
    );
  }
});

Deno.test("preset selections coalesce and conflicting targets are deterministic", () => {
  const presets = [{
    id: "a",
    name: "A",
    summary: "Test preset.",
    changes: [{ featureId: "git", enabled: true }],
  }, {
    id: "b",
    name: "B",
    summary: "Test preset.",
    changes: [{ featureId: "git", enabled: true }],
  }, {
    id: "off",
    name: "Off",
    summary: "Test preset.",
    changes: [{ featureId: "git", enabled: false }],
  }];
  const base = registry([feature("git")], [], presets);
  assertEquals(
    resolveFeatureChanges(
      base,
      detections({ git: "disabled" }),
      { ...request(), presets: ["b", "a"] },
    ).changes,
    [{
      featureId: "git",
      enabled: true,
      reason: { kind: "preset", presetId: "a" },
    }],
  );
  const forward = resolveFeatureChanges(
    base,
    detections({ git: "disabled" }),
    { ...request(), presets: ["a", "off"] },
  );
  const reverse = resolveFeatureChanges(
    base,
    detections({ git: "disabled" }),
    { ...request(), presets: ["off", "a"] },
  );
  assertEquals(forward.issues, [{
    code: "conflicting-preset-target",
    featureId: "git",
  }]);
  assertEquals(reverse.issues, forward.issues);
});

Deno.test("more-specific presets override prefixes but not explicit flags", () => {
  const presets = [{
    id: "base",
    name: "Base",
    summary: "Test preset.",
    changes: [{ featureId: "git", enabled: true }],
  }, {
    id: "base-off",
    name: "Overlay",
    summary: "Test overlay.",
    changes: [{ featureId: "git", enabled: false }],
  }];
  const base = registry([feature("git")], [], presets);
  for (const selected of [["base", "base-off"], ["base-off", "base"]]) {
    assertEquals(
      resolveFeatureChanges(
        base,
        detections({ git: "disabled" }),
        { ...request(), presets: selected },
      ),
      { changes: [], issues: [] },
    );
  }
  assertEquals(
    resolveFeatureChanges(
      base,
      detections({ git: "disabled" }),
      {
        ...request([{ featureId: "git", enabled: true }]),
        presets: ["base", "base-off"],
      },
    ).changes,
    [{
      featureId: "git",
      enabled: true,
      reason: { kind: "explicit-request" },
    }],
  );
});

Deno.test("enabling includes transitive direct dependencies", () => {
  const result = resolveFeatureChanges(
    registry([
      feature("app", { dependencies: ["lib"] }),
      feature("lib", { dependencies: ["fmt"] }),
      feature("fmt"),
    ]),
    detections({ app: "disabled", lib: "disabled", fmt: "disabled" }),
    request([{ featureId: "app", enabled: true }]),
  );
  assertEquals(result.changes.map((change) => change.featureId), [
    "fmt",
    "lib",
    "app",
  ]);
});

Deno.test("an explicit disabled dependency blocks an enabled feature", () => {
  const result = resolveFeatureChanges(
    registry([feature("app", { dependencies: ["lib"] }), feature("lib")]),
    detections({ app: "disabled", lib: "disabled" }),
    request([{ featureId: "app", enabled: true }, {
      featureId: "lib",
      enabled: false,
    }]),
  );
  assertEquals(result.issues.map((issue) => issue.code), [
    "direct-dependent-remains-enabled",
    "explicitly-disabled-dependency",
  ]);
});

Deno.test("a required capability selects its default provider", () => {
  const result = resolveFeatureChanges(
    registry([
      feature("app", { requires: ["readme"] }),
      feature("static", { provides: ["readme"] }),
    ], [{
      id: "readme",
      providerPolicy: "exclusive",
      defaultProvider: "static",
    }]),
    detections({ app: "disabled", static: "disabled" }),
    request([{ featureId: "app", enabled: true }]),
  );
  assertEquals(result.changes.map((change) => change.featureId), [
    "static",
    "app",
  ]);
});

Deno.test("an existing provider wins unless an explicit provider is enabled", () => {
  const features = [
    feature("app", { requires: ["readme"] }),
    feature("static", { provides: ["readme"] }),
    feature("build", { provides: ["readme"] }),
  ];
  const base = registry(features, [{
    id: "readme",
    providerPolicy: "exclusive",
    defaultProvider: "static",
  }]);
  assertEquals(
    resolveFeatureChanges(
      base,
      detections({ app: "disabled", static: "disabled", build: "enabled" }),
      request([{ featureId: "app", enabled: true }]),
    ).changes.map((change) => change.featureId),
    ["app"],
  );
  assertEquals(
    resolveFeatureChanges(
      base,
      detections({ app: "disabled", static: "enabled", build: "disabled" }),
      request([{ featureId: "app", enabled: true }, {
        featureId: "build",
        enabled: true,
      }]),
    ).changes.map((change) => change.featureId),
    ["build", "app", "static"],
  );
});

Deno.test("exclusive replacement records its replacement reason", () => {
  const result = resolveFeatureChanges(
    registry([
      feature("static", { provides: ["readme"] }),
      feature("build", { provides: ["readme"] }),
    ], [{
      id: "readme",
      providerPolicy: "exclusive",
      defaultProvider: "static",
    }]),
    detections({ static: "enabled", build: "disabled" }),
    request([{ featureId: "build", enabled: true }]),
  );
  assertEquals(result.changes, [
    { featureId: "build", enabled: true, reason: { kind: "explicit-request" } },
    {
      featureId: "static",
      enabled: false,
      reason: {
        kind: "exclusive-provider-replacement",
        capabilityId: "readme",
        replacedBy: "build",
      },
    },
  ]);
});

Deno.test("multiple providers coexist and missing providers block", () => {
  const multiple = resolveFeatureChanges(
    registry([
      feature("one", { provides: ["log"] }),
      feature("two", { provides: ["log"] }),
    ], [{ id: "log", providerPolicy: "multiple", defaultProvider: "one" }]),
    detections({ one: "enabled", two: "disabled" }),
    request([{ featureId: "two", enabled: true }]),
  );
  assertEquals(multiple.changes.map((change) => change.featureId), ["two"]);
  const missing = resolveFeatureChanges(
    registry([feature("app", { requires: ["log"] })], [{
      id: "log",
      providerPolicy: "multiple",
    }]),
    detections({ app: "disabled" }),
    request([{ featureId: "app", enabled: true }]),
  );
  assertEquals(missing.issues.map((issue) => issue.code), [
    "missing-capability-provider",
  ]);
});

Deno.test("disabling blocks direct dependents and unsatisfied capability consumers", () => {
  const dependent = resolveFeatureChanges(
    registry([feature("app", { dependencies: ["lib"] }), feature("lib")]),
    detections({ app: "enabled", lib: "enabled" }),
    request([{ featureId: "lib", enabled: false }]),
  );
  assertEquals(dependent.issues.map((issue) => issue.code), [
    "direct-dependent-remains-enabled",
  ]);
  const provider = resolveFeatureChanges(
    registry([
      feature("app", { requires: ["log"] }),
      feature("log", { provides: ["log"] }),
    ], [{ id: "log", providerPolicy: "multiple", defaultProvider: "log" }]),
    detections({ app: "enabled", log: "enabled" }),
    request([{ featureId: "log", enabled: false }]),
  );
  assertEquals(provider.issues.map((issue) => issue.code), [
    "capability-consumer-remains-enabled",
  ]);
});

Deno.test("explicitly disabling dependents is allowed and dependencies are not auto-removed", () => {
  const disabled = resolveFeatureChanges(
    registry([feature("app", { dependencies: ["lib"] }), feature("lib")]),
    detections({ app: "enabled", lib: "enabled" }),
    request([{ featureId: "app", enabled: false }, {
      featureId: "lib",
      enabled: false,
    }]),
  );
  assertEquals(disabled.issues, []);
  const orphan = resolveFeatureChanges(
    registry([feature("app", { dependencies: ["lib"] }), feature("lib")]),
    detections({ app: "enabled", lib: "enabled" }),
    request([{ featureId: "app", enabled: false }]),
  );
  assertEquals(orphan.changes.map((change) => change.featureId), ["app"]);
});

Deno.test("drifted features are present, ambiguous and unknown requested features block", () => {
  const drifted = resolveFeatureChanges(
    registry([feature("app", { dependencies: ["lib"] }), feature("lib")]),
    detections({ app: "disabled", lib: "drifted" }),
    request([{ featureId: "app", enabled: true }]),
  );
  assertEquals(drifted.changes.map((change) => change.featureId), ["app"]);
  const blocked = resolveFeatureChanges(
    registry([feature("app")]),
    detections({ app: "ambiguous" }),
    request([{ featureId: "app", enabled: true }, {
      featureId: "gone",
      enabled: true,
    }]),
  );
  assertEquals(blocked.issues.map((issue) => issue.code), [
    "ambiguous-feature",
    "unknown-requested-feature",
  ]);
});

Deno.test("resolver blocks invalid registries, unknown defaults, and contradictory requests", () => {
  const invalid = resolveFeatureChanges(
    registry([feature("same"), feature("same")]),
    detections({ same: "disabled" }),
    request([{ featureId: "same", enabled: true }]),
  );
  assertEquals(invalid.changes, []);
  assertEquals(invalid.issues[0].code, "invalid-registry");
  const defaults = resolveFeatureChanges(
    registry([feature("app")]),
    detections({ app: "disabled" }),
    request([], true, [{ kind: "feature", featureId: "gone" }, {
      kind: "capability",
      capabilityId: "gone",
    }]),
  );
  assertEquals(defaults.changes, []);
  assertEquals(defaults.issues.map((issue) => issue.code), [
    "unknown-default-capability",
    "unknown-default-feature",
  ]);
  const contradictory = resolveFeatureChanges(
    registry([feature("app")]),
    detections({ app: "disabled" }),
    request([{ featureId: "app", enabled: true }, {
      featureId: "app",
      enabled: false,
    }]),
  );
  assertEquals(contradictory.changes, []);
  assertEquals(contradictory.issues.map((issue) => issue.code), [
    "contradictory-feature-request",
  ]);
});

Deno.test("resolver reports unknown preset API input", () => {
  assertEquals(
    resolveFeatureChanges(
      registry([feature("app")]),
      detections({ app: "disabled" }),
      { ...request(), presets: ["gone"] },
    ).issues,
    [{ code: "unknown-requested-preset", relatedId: "gone" }],
  );
});

Deno.test("exclusive conflicts block ambiguous provider selection", () => {
  const features = [
    feature("app", { requires: ["readme"] }),
    feature("one", { provides: ["readme"] }),
    feature("two", { provides: ["readme"] }),
  ];
  const definitions = [{
    id: "readme",
    providerPolicy: "exclusive" as const,
    defaultProvider: "one",
  }];
  const bothExplicit = resolveFeatureChanges(
    registry(features, definitions),
    detections({ app: "disabled", one: "disabled", two: "disabled" }),
    request([{ featureId: "one", enabled: true }, {
      featureId: "two",
      enabled: true,
    }]),
  );
  assertEquals(bothExplicit.changes, []);
  assertEquals(bothExplicit.issues.map((issue) => issue.code), [
    "conflicting-exclusive-providers",
  ]);
  const present = resolveFeatureChanges(
    registry(features, definitions),
    detections({ app: "disabled", one: "enabled", two: "enabled" }),
    request([{ featureId: "app", enabled: true }]),
  );
  assertEquals(present.changes, []);
  assertEquals(present.issues.map((issue) => issue.code), [
    "conflicting-exclusive-providers",
  ]);
});

Deno.test("providers resolve dependencies, explicit providers, and alternate removal", () => {
  const closure = resolveFeatureChanges(
    registry([
      feature("app", { requires: ["readme"] }),
      feature("provider", { dependencies: ["fmt"], provides: ["readme"] }),
      feature("fmt"),
    ], [{
      id: "readme",
      providerPolicy: "multiple",
      defaultProvider: "provider",
    }]),
    detections({ app: "disabled", provider: "disabled", fmt: "disabled" }),
    request([{ featureId: "app", enabled: true }]),
  );
  assertEquals(closure.changes.map((change) => change.featureId), [
    "fmt",
    "provider",
    "app",
  ]);
  const explicit = resolveFeatureChanges(
    registry([
      feature("app", { requires: ["readme"] }),
      feature("one", { provides: ["readme"] }),
      feature("two", { provides: ["readme"] }),
    ], [{ id: "readme", providerPolicy: "multiple", defaultProvider: "one" }]),
    detections({ app: "disabled", one: "disabled", two: "disabled" }),
    request([{ featureId: "app", enabled: true }, {
      featureId: "two",
      enabled: true,
    }]),
  );
  assertEquals(explicit.changes.map((change) => change.featureId), [
    "two",
    "app",
  ]);
  const removal = resolveFeatureChanges(
    registry([
      feature("app", { requires: ["log"] }),
      feature("one", { provides: ["log"] }),
      feature("two", { provides: ["log"] }),
    ], [{ id: "log", providerPolicy: "multiple", defaultProvider: "one" }]),
    detections({ app: "enabled", one: "enabled", two: "enabled" }),
    request([{ featureId: "one", enabled: false }]),
  );
  assertEquals(removal, {
    changes: [{
      featureId: "one",
      enabled: false,
      reason: { kind: "explicit-request" },
    }],
    issues: [],
  });
});

Deno.test("disable order puts dependents before dependencies", () => {
  const result = resolveFeatureChanges(
    registry([
      feature("z-app", { dependencies: ["a-lib"] }),
      feature("a-lib"),
    ]),
    detections({ "z-app": "enabled", "a-lib": "enabled" }),
    request([{ featureId: "a-lib", enabled: false }, {
      featureId: "z-app",
      enabled: false,
    }]),
  );
  assertEquals(result.changes.map((change) => change.featureId), [
    "z-app",
    "a-lib",
  ]);
});
