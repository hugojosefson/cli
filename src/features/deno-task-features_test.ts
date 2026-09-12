import { assertEquals, assertStringIncludes } from "@std/assert";
import { builtInFeatureRegistry } from "./built-in-feature-registry.ts";
import { parseFeatures } from "../cli/parse-features.ts";
import { runFeatures } from "../cli/run-features.ts";
import { denoTaskDefinitions, leafTaskDefinitions } from "./deno-tasks.ts";

Deno.test("task features use exact commands and canonical aggregates", () => {
  assertEquals(leafTaskDefinitions["deno-lint"], {
    description: "Fix lint locally; check lint in CI.",
    command:
      "sh -c 'if test -n \"${CI:-}\"; then exec deno lint; else exec deno lint --fix; fi'",
  });
  assertEquals(leafTaskDefinitions["deno-typecheck"], {
    description: "Type-check the project.",
    command: "deno check",
  });
  assertStringIncludes(
    leafTaskDefinitions["deno-test"].command as string,
    "deno test --parallel --trace-leaks --coverage=coverage",
  );
  assertEquals(
    denoTaskDefinitions(["deno-lint", "deno-typecheck", "deno-test"]).check,
    {
      description: "Run project checks.",
      dependencies: ["format", "lint", "typecheck", "test"],
    },
  );
});

Deno.test("every task subset has canonical check dependencies", () => {
  const ids = ["deno-lint", "deno-typecheck", "deno-test"] as const;
  for (let mask = 0; mask < 8; mask++) {
    const enabled = ids.filter((_, index) => mask & 1 << index);
    assertEquals(
      denoTaskDefinitions(enabled).check.dependencies,
      [
        "format",
        ...enabled.map((id) =>
          ({
            "deno-lint": "lint",
            "deno-typecheck": "typecheck",
            "deno-test": "test",
          })[id]
        ),
      ],
    );
  }
});

Deno.test("real runner composes and removes leaf tasks from one snapshot", async () => {
  const path = await Deno.makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-tasks-",
  });
  const root = new URL(`file://${path}/`);
  try {
    await run(root, ["--deno-lint", "--deno-typecheck", "--deno-test"]);
    let config = JSON.parse(
      await Deno.readTextFile(new URL("deno.jsonc", root)),
    );
    assertEquals(config.tasks.check.dependencies, [
      "format",
      "lint",
      "typecheck",
      "test",
    ]);
    await run(root, ["--no-deno-lint", "--no-deno-test"]);
    config = JSON.parse(await Deno.readTextFile(new URL("deno.jsonc", root)));
    assertEquals(config.tasks.check.dependencies, ["format", "typecheck"]);
    await run(root, ["--no-deno-typecheck", "--no-deno-fmt"]);
    assertEquals(
      (await run(root, [])).split("\n").slice(2).map((line) =>
        line.trim().split(/ +/).slice(0, 2).join(": ")
      ).join("\n"),
      builtInFeatureRegistry.features.map((feature) => feature.metadata.id)
        .sort().map((id) => `${id}: disabled`).join("\n"),
    );
  } finally {
    await Deno.remove(path, { recursive: true });
  }
});

function run(root: URL, flags: string[]): Promise<string> {
  return runFeatures(
    root,
    parseFeatures(["repo", "features", ...flags], builtInFeatureRegistry),
  );
}
