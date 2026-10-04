import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import { assertEquals } from "@std/assert";
import { builtInFeatureRegistry } from "../features/built-in-feature-registry.ts";
import {
  isWorkflowSourceOnlyChange,
  workflowCliChanges,
} from "./workflow-cli-changes.ts";

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

test("source-only repair preserves README only for already enabled workflows", () => {
  const context = {
    options: { workflowCli: "jsr-latest" },
    resolvedChanges: [{
      featureId: "github-ci",
      enabled: true,
      reason: { kind: "explicit-request" as const },
    }],
    detections: new Map([["github-ci", {
      state: "enabled" as const,
      evidence: [],
    }]]),
  };
  assertEquals(isWorkflowSourceOnlyChange(context), true);
  assertEquals(isWorkflowSourceOnlyChange({ ...context, options: {} }), false);
  assertEquals(
    isWorkflowSourceOnlyChange({ ...context, resolvedChanges: [] }),
    false,
  );
  assertEquals(
    isWorkflowSourceOnlyChange({
      ...context,
      resolvedChanges: [{ ...context.resolvedChanges[0], enabled: false }],
    }),
    false,
  );
  assertEquals(
    isWorkflowSourceOnlyChange({
      ...context,
      resolvedChanges: [...context.resolvedChanges, {
        ...context.resolvedChanges[0],
        featureId: "readme-build",
      }],
    }),
    false,
  );
  for (const state of ["disabled", "drifted", "ambiguous"] as const) {
    assertEquals(
      isWorkflowSourceOnlyChange({
        ...context,
        detections: new Map([["github-ci", {
          state,
          evidence: [],
          issues: [],
        }]]),
      }),
      false,
    );
  }
});
