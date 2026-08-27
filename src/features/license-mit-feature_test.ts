import { assertEquals } from "@std/assert";
import type { ArtifactObservation } from "../api/artifact-inspection.ts";
import type { OperationContext } from "../api/repository-context.ts";
import { createLicenseMitFeature } from "./license-mit-feature.ts";

const template = "Copyright <year> <copyright holders>\nterms\n";
const apacheTemplate = "Apache [yyyy] [name of copyright owner]\nterms\n";

Deno.test("MIT provider detects exact, drifted, and ambiguous LICENSE files", async () => {
  const feature = createLicenseMitFeature(
    source(template),
    source(apacheTemplate),
  );
  assertEquals(
    (await feature.detect(context({ kind: "absent" }))).state,
    "disabled",
  );
  assertEquals(
    (await feature.detect(context(file("Copyright 2026 Ada\nterms\n")))).state,
    "enabled",
  );
  assertEquals(
    (await feature.detect(context(file("Copyright 2025 Ada\nchanged\n"))))
      .state,
    "ambiguous",
  );
  assertEquals(
    (await feature.detect(context(file("other\n")))).state,
    "ambiguous",
  );
  assertEquals(
    (await feature.detect(context({ kind: "directory", stateDigest: "x" })))
      .state,
    "ambiguous",
  );
});

Deno.test("MIT provider writes resolved attribution and repairs only mode drift", async () => {
  const feature = createLicenseMitFeature(
    source(template),
    source(apacheTemplate),
  );
  const absent = context({ kind: "absent" }, {
    licenseHolder: "Ada",
    licenseYear: "2026",
  });
  const check = await feature.checkEnable(absent);
  if (check.result !== "allowed") throw new Error("expected allowed");
  const enabled = await feature.planEnable(absent, check);
  assertEquals(enabled.changes[0], {
    kind: "write-file",
    path: "LICENSE",
    content: "Copyright 2026 Ada\nterms\n",
    mode: 0o644,
    expectedDigest: undefined,
  });
  const drift = context(file("Copyright 1999 Grace\nterms\n", 0o755), {}, {
    kind: "features",
    featureIds: ["license-mit"],
  });
  const repair = await feature.checkEnable(drift);
  if (repair.result !== "allowed") throw new Error("expected repair");
  assertEquals(
    (await feature.planEnable(drift, repair)).changes[0],
    {
      kind: "set-file-mode",
      path: "LICENSE",
      mode: 0o644,
      expectedMode: 0o755,
    },
  );
});

Deno.test("MIT provider removes only exact downloaded content", async () => {
  const feature = createLicenseMitFeature(
    source(template),
    source(apacheTemplate),
  );
  const exact = context(file("Copyright 2026 Ada\nterms\n"));
  const check = await feature.checkDisable(exact);
  assertEquals(check.result, "allowed");
  if (check.result !== "allowed") throw new Error("expected disable");
  assertEquals((await feature.planDisable(exact, check)).changes, [{
    kind: "remove-file",
    path: "LICENSE",
    expectedDigest: "digest",
  }]);
  assertEquals(
    (await feature.checkDisable(
      context(file("Copyright 2026 Ada\ncustom\n")),
    )).result,
    "blocked",
  );
});

Deno.test("MIT provider does not download while LICENSE is absent", async () => {
  let calls = 0;
  const feature = createLicenseMitFeature(() => {
    calls++;
    return Promise.reject(new Error("offline"));
  }, source(apacheTemplate));
  assertEquals(
    (await feature.detect(context({ kind: "absent" }))).state,
    "disabled",
  );
  assertEquals(calls, 0);
});

function context(
  observation: ArtifactObservation,
  options = {},
  repair: OperationContext["repair"] = undefined,
): OperationContext {
  return {
    repositoryRoot: new URL("file:///tmp/opencode/license/"),
    files: {
      observe: () => Promise.resolve(observation),
      exists: () => Promise.resolve(false),
      readText: () => Promise.resolve(undefined),
      readJson: () => Promise.resolve(undefined),
      digest: () => Promise.resolve(undefined),
      directoryStateDigest: () => Promise.resolve(undefined),
      mode: () => Promise.resolve(undefined),
    },
    git: {
      isRepository: () => Promise.resolve(false),
      head: () => Promise.resolve(undefined),
      status: () => Promise.resolve(undefined),
      remotes: () => Promise.resolve([]),
      defaultBranch: () => Promise.resolve(undefined),
    },
    detections: new Map(),
    requestedChanges: [],
    resolvedChanges: [],
    repair,
    options,
  };
}

function file(content: string, mode = 0o644): ArtifactObservation {
  return { kind: "file", content, digest: "digest", mode };
}

function source(value: string) {
  return () => Promise.resolve(value);
}
