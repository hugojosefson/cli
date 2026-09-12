import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import { assertEquals, assertStringIncludes } from "@std/assert";
import { featureRecommendations } from "./feature-recommendations.ts";
import type { ChangePlan } from "../api/change-plan.ts";

test("auto-add recommendation belongs only to a changed enabled default project", () => {
  const plan: ChangePlan = {
    featureId: "github-default-project",
    action: "enable",
    summary: "",
    preconditions: [],
    warnings: [],
    validations: [],
    changes: [{
      kind: "upsert-github-resource",
      resource: "default-project",
      name: "default",
      definition: { enabled: true },
      expectedStateDigest: undefined,
    }],
  };
  const recommendation = featureRecommendations([plan, plan]);
  assertStringIncludes(recommendation, "hj repo project-auto-add --yes");
  assertStringIncludes(recommendation, "signed-in Firefox automation session");
  assertStringIncludes(recommendation, "https://github.com/hugojosefson/cli/");
  assertEquals(recommendation.match(/project-auto-add/g)?.length, 1);
  assertEquals(featureRecommendations([]), "");
  assertEquals(featureRecommendations([{ ...plan, action: "disable" }]), "");
  assertEquals(featureRecommendations([{ ...plan, changes: [] }]), "");
  assertEquals(
    featureRecommendations([{ ...plan, featureId: "github-projects" }]),
    "",
  );
});
