import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import { assertEquals } from "@std/assert";
import { builtInFeatureRegistry } from "../features/built-in-feature-registry.ts";
import { workflowCliChanges } from "./workflow-cli-changes.ts";

test("workflow source selection expands presets and dependencies without duplicate or disabled changes", () => {
  const request = {
    changes: [],
    presets: ["jsr"],
    defaults: [],
    applyDefaults: false,
  };
  const changes = workflowCliChanges(request, builtInFeatureRegistry, []);
  assertEquals(changes.map((change) => change.featureId).sort(), [
    "github-ci",
    "github-release-publish-jsr",
    "github-release-publish-tag",
  ]);
  assertEquals(
    workflowCliChanges(request, builtInFeatureRegistry, changes),
    [],
  );
  assertEquals(
    workflowCliChanges(
      {
        ...request,
        changes: [{ featureId: "github-release-publish-jsr", enabled: false }],
      },
      builtInFeatureRegistry,
      [],
    ),
    [],
  );
});
