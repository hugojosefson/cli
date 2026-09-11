import { assertEquals, assertThrows } from "@std/assert";
import { builtInFeatureRegistry } from "../features/built-in-feature-registry.ts";
import { formatFeatureStatus } from "./format-features.ts";
import {
  featureDefaults,
  type FeaturesArguments,
  parseFeatures,
} from "./parse-features.ts";

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
    changeRequest(parseFeatures(
      ["repo", "features", "--license-apache-2.0"],
      builtInFeatureRegistry,
    )).changes,
    [{ featureId: "license-apache-2.0", enabled: true }],
  );
  for (
    const id of [
      "license-gpl-2.0-only",
      "license-gpl-3.0-only",
      "license-agpl-3.0-only",
      "license-isc",
      "license-bsd-2-clause",
      "license-bsd-3-clause",
      "license-mpl-2.0",
      "license-unlicense",
    ]
  ) {
    assertEquals(
      changeRequest(parseFeatures(
        ["repo", "features", `--${id}`],
        builtInFeatureRegistry,
      )).changes,
      [{ featureId: id, enabled: true }],
    );
  }
  assertEquals(
    parseFeatures(["repo", "features", "--readme"], builtInFeatureRegistry),
    {
      kind: "change",
      confirmation: false,
      request: {
        changes: [{ featureId: "readme-static", enabled: true }],
        presets: [],
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
      new Map(
        builtInFeatureRegistry.features.map((feature) => [feature.metadata.id, {
          state: feature.metadata.id === "git"
            ? "enabled" as const
            : "disabled" as const,
          evidence: [],
        }]),
      ),
    ).split("\n").slice(2).map((line) =>
      line.trim().split(/ +/).slice(0, 2).join(": ")
    ).join("\n"),
    builtInFeatureRegistry.features.map((feature) => feature.metadata.id).sort()
      .map((id) => `${id}: ${id === "git" ? "enabled" : "disabled"}`).join(
        "\n",
      ),
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
        presets: [],
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
        presets: [],
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

Deno.test("parses positive presets and rejects duplicate and negative forms", () => {
  const registry = {
    ...builtInFeatureRegistry,
    presets: [{
      id: "github",
      name: "GitHub",
      summary: "Test preset.",
      changes: [{ featureId: "git", enabled: true }],
    }],
  };
  assertEquals(
    parseFeatures(["repo", "features", "--github"], registry),
    {
      kind: "change",
      confirmation: false,
      request: {
        changes: [],
        presets: ["github"],
        applyDefaults: false,
        defaults: featureDefaults,
      },
    },
  );
  assertThrows(
    () => parseFeatures(["repo", "features", "--github", "--github"], registry),
    Error,
    "duplicate preset",
  );
  assertThrows(
    () => parseFeatures(["repo", "features", "--no-github"], registry),
    Error,
    "cannot",
  );
  for (
    const args of [
      ["repo", "features", "--github", "--no-git"],
      ["repo", "features", "--no-git", "--github"],
    ]
  ) {
    assertEquals(changeRequest(parseFeatures(args, registry)), {
      changes: [{ featureId: "git", enabled: false }],
      presets: ["github"],
      applyDefaults: false,
      defaults: featureDefaults,
    });
  }
});

function changeRequest(args: FeaturesArguments) {
  if (args.kind !== "change") throw new Error("expected change request");
  return args.request;
}
