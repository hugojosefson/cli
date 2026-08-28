import { assert, assertEquals } from "@std/assert";
import { initialDenoConfig } from "./deno-initial-config.ts";
import { jsrPackageFeature } from "./jsr-package-feature.ts";
import {
  context,
  ownedTasks,
  withRepository,
  writeConfig,
} from "./jsr-package-feature-support.ts";
import { publishCheckDefinition } from "./jsr-package-config.ts";
import { builtInFeatureRegistry } from "./built-in-feature-registry.ts";
import { resolveFeatureChanges } from "./resolve-feature-changes.ts";

Deno.test("jsr-package composes identity and publish checks into an initial config", async () => {
  await withRepository(async (root) => {
    const value = await initialDenoConfig(context(root), {
      exports: { ".": "./mod.ts" },
      tasks: { check: { dependencies: ["format"] } },
    }, "deno-fmt");
    assertEquals(value.name, "@owner/repository");
    assertEquals(value.version, "0.0.0");
    assertEquals(
      (value.tasks as Record<string, unknown>)["publish-check"],
      publishCheckDefinition,
    );
    assertEquals(
      (value.tasks as { check: { dependencies: string[] } }).check.dependencies,
      ["format", "publish-check"],
    );
  });
});

Deno.test("jsr-package uses an explicitly enabled built-in deno-export provider", () => {
  const detections = Object.fromEntries(
    builtInFeatureRegistry.features.map((
      feature,
    ) => [feature.metadata.id, { state: "disabled" as const, evidence: [] }]),
  );
  const result = resolveFeatureChanges(builtInFeatureRegistry, detections, {
    changes: [{ featureId: "deno-lib", enabled: true }, {
      featureId: "jsr-package",
      enabled: true,
    }],
    presets: [],
    applyDefaults: false,
    defaults: [],
  });
  assertEquals(result.issues, []);
  assert(result.changes.some((change) => change.featureId === "deno-lib"));
  assert(result.changes.some((change) => change.featureId === "jsr-package"));
});

Deno.test("jsr-package reports a missing deno-export provider", () => {
  const detections = Object.fromEntries(
    builtInFeatureRegistry.features.map((
      feature,
    ) => [feature.metadata.id, { state: "disabled" as const, evidence: [] }]),
  );
  const result = resolveFeatureChanges(builtInFeatureRegistry, detections, {
    changes: [{ featureId: "jsr-package", enabled: true }],
    presets: [],
    applyDefaults: false,
    defaults: [],
  });
  assertEquals(result.issues.map((issue) => issue.code), [
    "missing-capability-provider",
  ]);
  assertEquals(result.changes, []);
});

for (
  const version of [
    "0.0.0",
    "1.2.3-beta.1",
    "1.2.3+build.4",
    "01.2.3",
    "1.2",
    "1.2.3-",
  ]
) {
  Deno.test(`jsr-package SemVer ${version}`, async () => {
    await withRepository(async (root) => {
      await writeConfig(root, {
        name: "@owner/repository",
        version,
        exports: { ".": "./mod.ts" },
        tasks: ownedTasks(),
      });
      assertEquals(
        (await jsrPackageFeature.detect(context(root))).state,
        /^(0\.0\.0|1\.2\.3-beta\.1|1\.2\.3\+build\.4)$/.test(version)
          ? "enabled"
          : "ambiguous",
      );
    });
  });
}
