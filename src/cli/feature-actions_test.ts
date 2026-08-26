import { assertEquals, assertThrows } from "@std/assert";
import { builtInFeatureRegistry } from "../features/built-in-feature-registry.ts";
import {
  featureActions,
  selectedFeatureActionsToRequest,
} from "./feature-actions.ts";

Deno.test("lists deterministic actions from feature detections", () => {
  assertEquals(
    featureActions(
      builtInFeatureRegistry,
      new Map([
        ["readme-static", { state: "drifted", evidence: [], issues: [] }],
        ["git", { state: "disabled", evidence: [] }],
      ]),
    ),
    [
      { value: "enable:git", label: "enable git" },
      { value: "repair:readme-static", label: "repair readme-static" },
      { value: "disable:readme-static", label: "disable readme-static" },
    ],
  );
});

Deno.test("converts selected actions into feature requests", () => {
  assertEquals(
    selectedFeatureActionsToRequest(["enable:git", "repair:readme-static"]),
    {
      changes: [{ featureId: "git", enabled: true }],
      applyDefaults: false,
      defaults: [{ kind: "feature", featureId: "git" }, {
        kind: "capability",
        capabilityId: "readme",
      }],
      repair: { kind: "features", featureIds: ["readme-static"] },
    },
  );
  assertEquals(selectedFeatureActionsToRequest([]).changes, []);
  assertThrows(
    () => selectedFeatureActionsToRequest(["repair:git", "disable:git"]),
    Error,
    "contradictory repair",
  );
  assertThrows(
    () => selectedFeatureActionsToRequest(["unknown:git"]),
    Error,
    "unknown interactive action",
  );
});
