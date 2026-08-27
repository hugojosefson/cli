import { assertEquals, assertThrows } from "@std/assert";
import { builtInFeatureRegistry } from "../features/built-in-feature-registry.ts";
import { formatFeatureStatus } from "./format-features.ts";
import { type FeaturesArguments, parseFeatures } from "./parse-features.ts";

Deno.test("parses built-in features, capability aliases, and defaults", () => {
  assertEquals(
    changeRequest(parseFeatures(
      ["repo", "features", "--deno-fmt"],
      builtInFeatureRegistry,
    )).changes,
    [{ featureId: "deno-fmt", enabled: true }],
  );
  assertEquals(
    changeRequest(parseFeatures(
      ["repo", "features", "--deno-lib"],
      builtInFeatureRegistry,
    )).changes,
    [{ featureId: "deno-lib", enabled: true }],
  );
  assertEquals(
    changeRequest(parseFeatures(
      ["repo", "features", "--deno-cli"],
      builtInFeatureRegistry,
    )).changes,
    [{ featureId: "deno-cli", enabled: true }],
  );
  assertEquals(
    parseFeatures(["repo", "features", "--readme"], builtInFeatureRegistry),
    {
      kind: "change",
      confirmation: false,
      request: {
        changes: [{ featureId: "readme-static", enabled: true }],
        applyDefaults: false,
        defaults: [{ kind: "feature", featureId: "git" }, {
          kind: "capability",
          capabilityId: "readme",
        }],
      },
    },
  );
  assertEquals(
    changeRequest(parseFeatures(
      ["repo", "features", "--no-readme", "--defaults"],
      builtInFeatureRegistry,
    )).changes,
    [{ featureId: "readme-static", enabled: false }, {
      featureId: "readme-build",
      enabled: false,
    }],
  );
  assertThrows(
    () =>
      parseFeatures(
        ["repo", "features", "--git", "--no-git"],
        builtInFeatureRegistry,
      ),
    Error,
    "contradictory",
  );
  assertThrows(
    () => parseFeatures(["repo", "features", "extra"], builtInFeatureRegistry),
    Error,
    "unexpected",
  );
});

Deno.test("formats statuses by stable feature ID", () => {
  assertEquals(
    formatFeatureStatus(
      builtInFeatureRegistry,
      new Map([
        ["deno-cli", { state: "disabled", evidence: [] }],
        ["deno-fmt", { state: "disabled", evidence: [] }],
        ["deno-lint", { state: "disabled", evidence: [] }],
        ["deno-lib", { state: "disabled", evidence: [] }],
        ["deno-server", { state: "disabled", evidence: [] }],
        ["deno-test", { state: "disabled", evidence: [] }],
        ["deno-typecheck", { state: "disabled", evidence: [] }],
        ["readme-static", { state: "disabled", evidence: [] }],
        ["readme-build", { state: "disabled", evidence: [] }],
        ["git", { state: "enabled", evidence: [] }],
      ]),
    ),
    "deno-cli: disabled\ndeno-fmt: disabled\ndeno-lib: disabled\ndeno-lint: disabled\ndeno-server: disabled\ndeno-test: disabled\ndeno-typecheck: disabled\ngit: enabled\nreadme-build: disabled\nreadme-static: disabled",
  );
});

Deno.test("parses explicit repair selections and rejects negative flags", () => {
  assertEquals(
    parseFeatures(["repo", "features", "--repair"], builtInFeatureRegistry),
    {
      kind: "change",
      confirmation: false,
      request: {
        changes: [],
        applyDefaults: false,
        defaults: [{ kind: "feature", featureId: "git" }, {
          kind: "capability",
          capabilityId: "readme",
        }],
        repair: { kind: "all-drifted" },
      },
    },
  );
  assertEquals(
    changeRequest(parseFeatures(
      ["repo", "features", "--repair", "--readme"],
      builtInFeatureRegistry,
    )).repair,
    { kind: "features", featureIds: ["readme-static"] },
  );
  assertThrows(
    () =>
      parseFeatures(
        ["repo", "features", "--repair", "--no-readme"],
        builtInFeatureRegistry,
      ),
    Error,
    "negative",
  );
});

Deno.test("parses interactive mode and rejects incompatible options", () => {
  assertEquals(
    parseFeatures(["repo", "features", "-i"], builtInFeatureRegistry),
    { kind: "interactive", confirmation: false },
  );
  for (
    const args of [
      ["repo", "features", "--interactive", "--defaults"],
      ["repo", "features", "--interactive", "--repair"],
      ["repo", "features", "--interactive", "--git"],
    ]
  ) {
    assertThrows(
      () => parseFeatures(args, builtInFeatureRegistry),
      Error,
      "cannot",
    );
  }
  assertEquals(
    parseFeatures(
      ["repo", "features", "--interactive", "--yes"],
      builtInFeatureRegistry,
    ),
    { kind: "interactive", confirmation: true },
  );
});

Deno.test("parses confirmation without changing status or feature resolution", () => {
  assertEquals(
    parseFeatures(["repo", "features", "--yes"], builtInFeatureRegistry),
    {
      kind: "status",
      confirmation: true,
      request: {
        changes: [],
        applyDefaults: false,
        defaults: [{ kind: "feature", featureId: "git" }, {
          kind: "capability",
          capabilityId: "readme",
        }],
      },
    },
  );
  assertEquals(
    changeRequest(parseFeatures(
      ["repo", "features", "--yes", "--defaults", "--repair", "--git"],
      builtInFeatureRegistry,
    )).changes,
    [{ featureId: "git", enabled: true }],
  );
  const disabled = parseFeatures(
    ["repo", "features", "--yes", "--no-readme"],
    builtInFeatureRegistry,
  );
  if (disabled.kind !== "change") throw new Error("expected change request");
  assertEquals(disabled.confirmation, true);
  assertEquals(disabled.request.changes, [
    { featureId: "readme-static", enabled: false },
    { featureId: "readme-build", enabled: false },
  ]);
  assertThrows(
    () =>
      parseFeatures(
        ["repo", "features", "--yes", "--yes"],
        builtInFeatureRegistry,
      ),
    Error,
    "duplicate `--yes`",
  );
});

function changeRequest(args: FeaturesArguments) {
  if (args.kind !== "change") throw new Error("expected change request");
  return args.request;
}
