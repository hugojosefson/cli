import { assertEquals, assertThrows } from "@std/assert";
import { builtInFeatureRegistry } from "../features/built-in-feature-registry.ts";
import { formatFeatureStatus } from "./format-features.ts";
import { parseFeatures } from "./parse-features.ts";

Deno.test("parses built-in features, capability aliases, and defaults", () => {
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
    parseFeatures(
      ["repo", "features", "--no-readme", "--defaults"],
      builtInFeatureRegistry,
    ).request.changes,
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
        ["readme-static", { state: "disabled", evidence: [] }],
        ["git", { state: "enabled", evidence: [] }],
      ]),
    ),
    "git: enabled\nreadme-static: disabled",
  );
});
