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
    parseFeatures(["repo", "features", "--readme"], builtInFeatureRegistry),
    {
      kind: "change",
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
    [{ featureId: "readme-static", enabled: false }],
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
        ["deno-fmt", { state: "disabled", evidence: [] }],
        ["deno-lib", { state: "disabled", evidence: [] }],
        ["readme-static", { state: "disabled", evidence: [] }],
        ["git", { state: "enabled", evidence: [] }],
      ]),
    ),
    "deno-fmt: disabled\ndeno-lib: disabled\ngit: enabled\nreadme-static: disabled",
  );
});

Deno.test("parses explicit repair selections and rejects negative flags", () => {
  assertEquals(
    parseFeatures(["repo", "features", "--repair"], builtInFeatureRegistry),
    {
      kind: "change",
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
    { kind: "interactive" },
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
});

function changeRequest(args: FeaturesArguments) {
  if (args.kind !== "change") throw new Error("expected change request");
  return args.request;
}
