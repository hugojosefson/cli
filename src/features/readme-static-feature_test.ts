import { assertEquals } from "@std/assert";
import type { ArtifactObservation } from "../api/artifact-inspection.ts";
import type { OperationContext } from "../api/repository-context.ts";
import { readmeStaticFeature } from "./readme-static-feature.ts";

function context(observation: ArtifactObservation): OperationContext {
  return {
    repositoryRoot: new URL("file:///work/my%20repository/"),
    files: {
      observe: (path) =>
        Promise.resolve(
          path === "README.md" ? observation : { kind: "absent" },
        ),
      exists: () => Promise.resolve(false),
      readText: () => Promise.resolve(undefined),
      readJson: () => Promise.resolve(undefined),
      digest: () => Promise.resolve(undefined),
      directoryStateDigest: () => Promise.resolve(undefined),
      mode: () => Promise.resolve(undefined),
    },
    git: {
      isRepository: () => Promise.reject(new Error("README must not use Git")),
      head: () => Promise.reject(new Error("README must not use Git")),
      status: () => Promise.reject(new Error("README must not use Git")),
      remotes: () => Promise.reject(new Error("README must not use Git")),
      defaultBranch: () => Promise.reject(new Error("README must not use Git")),
    },
    detections: new Map(),
    requestedChanges: [],
    resolvedChanges: [],
    repair: undefined,
    options: {},
  };
}

const exact: ArtifactObservation = {
  kind: "file",
  content: "# my-repository\n",
  digest: "exact-digest",
  mode: 0o644,
};

Deno.test("readme-static detects writable content and ambiguous artifacts", async () => {
  assertEquals(await readmeStaticFeature.detect(context({ kind: "absent" })), {
    state: "disabled",
    evidence: [{
      code: "readme-static-absent",
      kind: "readme-static",
      subject: { kind: "repository-path", identifier: "README.md" },
      observation: "README.md is absent.",
    }],
  });
  assertEquals(await readmeStaticFeature.detect(context(exact)), {
    state: "enabled",
    evidence: [{
      code: "readme-static-writable",
      kind: "readme-static",
      subject: { kind: "repository-path", identifier: "README.md" },
      observation: "README.md is a writable static README.",
    }],
  });
  assertEquals(
    (await readmeStaticFeature.detect(context({ ...exact, mode: 0o755 })))
      .state,
    "enabled",
  );
  assertEquals(
    (await readmeStaticFeature.detect(
      context({ kind: "symlink", target: "other" }),
    )).state,
    "ambiguous",
  );
  assertEquals(
    (await readmeStaticFeature.detect(context({
      kind: "unreadable",
      observation: "permission denied",
    }))).state,
    "ambiguous",
  );
});

Deno.test("readme-static plans only absent creation and exact digest-guarded removal", async () => {
  const absent = context({ kind: "absent" });
  const enable = await readmeStaticFeature.checkEnable(absent);
  assertEquals(enable, {
    result: "allowed",
    warnings: [],
    preconditions: [{
      kind: "file-digest",
      path: "README.md",
      digest: undefined,
    }],
  });
  if (enable.result !== "allowed") {
    throw new Error("test setup requires enable");
  }
  assertEquals(await readmeStaticFeature.planEnable(absent, enable), {
    featureId: "readme-static",
    action: "enable",
    summary: "Create the exact starter README.md.",
    warnings: [],
    preconditions: [{
      kind: "file-digest",
      path: "README.md",
      digest: undefined,
    }],
    changes: [{
      kind: "write-file",
      path: "README.md",
      content: "# my-repository\n",
      mode: 0o644,
      expectedDigest: undefined,
    }],
    validations: [{
      kind: "feature-redetection",
      featureId: "readme-static",
      expected: "enabled",
    }],
  });

  const adopted = context(exact);
  const disable = await readmeStaticFeature.checkDisable(adopted);
  assertEquals(disable, {
    result: "allowed",
    warnings: [],
    preconditions: [{
      kind: "file-digest",
      path: "README.md",
      digest: "exact-digest",
    }],
  });
  if (disable.result !== "allowed") {
    throw new Error("test setup requires disable");
  }
  assertEquals(
    (await readmeStaticFeature.planDisable(adopted, disable)).changes,
    [{
      kind: "remove-file",
      path: "README.md",
      expectedDigest: "exact-digest",
    }],
  );
});

Deno.test("readme-static preserves writable edits and blocks ambiguity without Git", async () => {
  for (
    const observation of [
      { ...exact, content: "# edited\n" },
      { kind: "directory", stateDigest: "directory-digest" },
    ] as const
  ) {
    for (const operation of ["enable", "disable"] as const) {
      const result = operation === "enable"
        ? await readmeStaticFeature.checkEnable(context(observation))
        : await readmeStaticFeature.checkDisable(context(observation));
      assertEquals(
        result.result,
        observation.kind === "file" ? "no-op" : "blocked",
      );
      if (result.result === "blocked") {
        assertEquals(result.blockers[0].resolution.includes("README.md"), true);
      }
    }
  }
});

Deno.test("readme-static reports already-satisfied operations as no-ops", async () => {
  assertEquals(await readmeStaticFeature.checkEnable(context(exact)), {
    result: "no-op",
    reason: "README.md is already writable.",
    warnings: [],
  });
  assertEquals(
    await readmeStaticFeature.checkDisable(context({ kind: "absent" })),
    {
      result: "no-op",
      reason: "README.md is already absent.",
      warnings: [],
    },
  );
});
