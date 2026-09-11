import { assertEquals, assertStringIncludes } from "@std/assert";
import { formatFeatureStatus } from "./format-features.ts";
import { builtInFeatureRegistry } from "../features/built-in-feature-registry.ts";

Deno.test("status shows all distinct issues and identifies missing results", () => {
  const subject = { kind: "file", identifier: "deno.json" };
  const problem = {
    code: "custom",
    kind: "task",
    subject,
    observation: "Custom task",
    resolution: "Review the task",
  };
  const output = formatFeatureStatus(
    {
      features: builtInFeatureRegistry.features.filter((feature) =>
        ["git", "deno-fmt"].includes(feature.metadata.id)
      ),
      capabilities: [],
    },
    new Map([["deno-fmt", {
      state: "drifted" as const,
      evidence: [],
      issues: [problem, problem, {
        ...problem,
        observation: "Custom aggregate",
      }],
    }]]),
  );
  assertStringIncludes(output, "Managed state");
  assertStringIncludes(output, "Custom aggregate");
  assertEquals(output.match(/Custom task/g)?.length, 1);
  assertStringIncludes(output.replace(/ +/g, " "), "git unknown");
});
