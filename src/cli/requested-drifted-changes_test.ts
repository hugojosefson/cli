import { assertEquals } from "@std/assert";
import type { FeatureChangeRequest } from "../api/feature-change.ts";
import type { FeatureDetection } from "../api/feature-detection.ts";
import { requestedDriftedChanges } from "./requested-drifted-changes.ts";

Deno.test("explicit enables reach drift safety checks", () => {
  const detections = new Map<string, FeatureDetection>([
    ["drifted", { state: "drifted", evidence: [], issues: [] }],
    ["enabled", { state: "enabled", evidence: [] }],
  ]);
  const request: FeatureChangeRequest = {
    changes: [{ featureId: "drifted", enabled: true }, {
      featureId: "enabled",
      enabled: true,
    }],
    applyDefaults: false,
    defaults: [],
  };
  assertEquals(requestedDriftedChanges(detections, request), [{
    featureId: "drifted",
    enabled: true,
    reason: { kind: "explicit-request" },
  }]);
  assertEquals(
    requestedDriftedChanges(detections, {
      ...request,
      repair: { kind: "all-drifted" },
    }),
    [],
  );
});
