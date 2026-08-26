import { assertEquals } from "@std/assert";
import type { ArtifactObservation } from "../api/artifact-inspection.ts";
import type { OperationContext } from "../api/repository-context.ts";
import { readmeStaticFeature } from "./readme-static-feature.ts";

function context(
  observation: ArtifactObservation,
  repair: OperationContext["repair"] = {
    kind: "features",
    featureIds: ["readme-static"],
  },
): OperationContext {
  return {
    repositoryRoot: new URL("file:///work/example/"),
    files: {
      observe: () => Promise.resolve(observation),
      exists: () => Promise.resolve(false),
      readText: () => Promise.resolve(undefined),
      readJson: () => Promise.resolve(undefined),
      digest: () => Promise.resolve(undefined),
      directoryStateDigest: () => Promise.resolve(undefined),
      mode: () => Promise.resolve(undefined),
    },
    git: {} as OperationContext["git"],
    detections: new Map(),
    requestedChanges: [],
    resolvedChanges: [],
    repair,
    options: {},
  };
}

Deno.test("readme-static repairs selected drift with digest and mode guards", async () => {
  const drifted = context({
    kind: "file",
    content: "# edited\n",
    digest: "drift-digest",
    mode: 0o755,
  });
  const check = await readmeStaticFeature.checkEnable(drifted);
  assertEquals(check, {
    result: "allowed",
    warnings: [],
    preconditions: [{
      kind: "file-digest",
      path: "README.md",
      digest: "drift-digest",
    }],
  });
  if (check.result !== "allowed") throw new Error("test setup requires repair");
  assertEquals((await readmeStaticFeature.planEnable(drifted, check)).changes, [
    {
      kind: "write-file",
      path: "README.md",
      content: "# example\n",
      expectedDigest: "drift-digest",
    },
    {
      kind: "set-file-mode",
      path: "README.md",
      mode: 0o644,
      expectedMode: 0o755,
    },
  ]);
});

Deno.test("readme-static blocks unselected and ambiguous repair", async () => {
  const unselected = context(
    { kind: "file", content: "# edited\n", digest: "x", mode: 0o644 },
    { kind: "features", featureIds: [] },
  );
  const ambiguous = context(
    { kind: "symlink", target: "elsewhere" },
    { kind: "all-drifted" },
  );
  assertEquals(
    (await readmeStaticFeature.checkEnable(unselected)).result,
    "blocked",
  );
  assertEquals(
    (await readmeStaticFeature.checkEnable(ambiguous)).result,
    "blocked",
  );
});
