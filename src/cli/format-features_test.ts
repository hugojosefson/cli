import { assertEquals, assertStringIncludes } from "@std/assert";
import { formatFeatureResult, formatFeatureStatus } from "./format-features.ts";
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

Deno.test("feature rows style names and wrapped details according to state", () => {
  const registry = {
    features: builtInFeatureRegistry.features.filter((feature) =>
      feature.metadata.id === "git"
    ),
    capabilities: [],
  };
  const evidence = [{
    code: "observed",
    kind: "file",
    subject: { kind: "file", identifier: "test" },
    observation: "First line\n" + "detail ".repeat(20),
  }];
  for (
    const [state, code] of [["enabled", 32], ["disabled", 2], ["drifted", 33], [
      "ambiguous",
      31,
    ]] as const
  ) {
    const detections = new Map([["git", { state, evidence, issues: [] }]]);
    const plain = formatFeatureStatus(registry, detections);
    const colored = formatFeatureStatus(registry, detections, true);
    // deno-lint-ignore no-control-regex -- Compare visible text after ANSI removal.
    assertEquals(colored.replaceAll(/\u001b\[\d+m/g, ""), plain);
    assertStringIncludes(
      colored,
      `\x1b[${state === "enabled" ? 36 : code}mgit\x1b[0m`,
    );
    assertStringIncludes(colored, `\x1b[${code}m${state}\x1b[0m`);
    for (const line of colored.split("\n").slice(2)) {
      assertEquals(
        line.includes(`\x1b[${code}mdetail`),
        state !== "enabled" && line.includes("detail"),
      );
    }
    assertStringIncludes(
      colored,
      state === "enabled" ? "First line" : `\x1b[${code}mFirst line\x1b[0m`,
    );
  }
  assertStringIncludes(
    formatFeatureStatus(registry, new Map(), true),
    "\x1b[2mgit\x1b[0m",
  );
});

Deno.test("operation summaries report local and remote changes with optional color", () => {
  for (
    const result of [
      {
        committed: true,
        initializedGit: false,
        localChanged: true,
        githubChanged: false,
      },
      {
        committed: true,
        initializedGit: true,
        localChanged: true,
        githubChanged: false,
      },
      {
        committed: false,
        initializedGit: false,
        localChanged: false,
        githubChanged: true,
      },
      {
        committed: false,
        initializedGit: false,
        localChanged: true,
        githubChanged: true,
      },
      {
        committed: false,
        initializedGit: false,
        localChanged: false,
        githubChanged: false,
      },
    ]
  ) {
    const plain = formatFeatureResult("status", result);
    const colored = formatFeatureResult("status", result, true);
    assertStringIncludes(colored, "\x1b[");
    // deno-lint-ignore no-control-regex -- Compare visible text after ANSI removal.
    assertEquals(colored.replaceAll(/\u001b\[\d+m/g, ""), plain);
    assertEquals(plain.includes("Applied local changes."), result.localChanged);
    assertEquals(
      plain.includes("Applied GitHub changes."),
      result.githubChanged,
    );
  }
});
