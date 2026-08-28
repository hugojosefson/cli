import { assertEquals } from "@std/assert";
import type { ArtifactObservation } from "../api/artifact-inspection.ts";
import type { ResolvedFeatureChange } from "../api/feature-change.ts";
import type { OperationContext } from "../api/repository-context.ts";
import { createLicenseApache20Feature } from "./license-apache-2.0-feature.ts";
import { createLicenseMitFeature } from "./license-mit-feature.ts";

const apache = "Apache [yyyy] [name of copyright owner]\nterms\n";
const mit = "MIT <year> <copyright holders>\nterms\n";

Deno.test("Apache provider recognizes exact templates and guarded alternates", async () => {
  const feature = createLicenseApache20Feature(source(apache), source(mit));
  assertEquals(
    (await feature.detect(context(file("Apache 2026 Ada\nterms\n")))).state,
    "enabled",
  );
  assertEquals(
    (await feature.detect(context(file("MIT 2026 Ada\nterms\n")))).state,
    "disabled",
  );
  assertEquals(
    (await feature.detect(context(file("edited\n")))).state,
    "ambiguous",
  );
  assertEquals(
    (await createLicenseApache20Feature(source(apache), failing).detect(
      context(file("MIT 2026 Ada\nterms\n")),
    )).state,
    "ambiguous",
  );
});

Deno.test("Apache provider writes attribution, repairs mode, and removes only exact content", async () => {
  const feature = createLicenseApache20Feature(source(apache), source(mit));
  const initial = context({ kind: "absent" }, {
    licenseHolder: "Ada",
    licenseYear: "2026",
  });
  const enable = await feature.checkEnable(initial);
  if (enable.result !== "allowed") throw new Error("expected enable");
  assertEquals((await feature.planEnable(initial, enable)).changes[0], {
    kind: "write-file",
    path: "LICENSE",
    content: "Apache 2026 Ada\nterms\n",
    mode: 0o644,
    expectedDigest: undefined,
  });
  const drift = context(file("Apache 2026 Ada\nterms\n", 0o755), {}, {
    kind: "features",
    featureIds: ["license-apache-2.0"],
  });
  const repair = await feature.checkEnable(drift);
  if (repair.result !== "allowed") throw new Error("expected repair");
  assertEquals((await feature.planEnable(drift, repair)).changes[0], {
    kind: "set-file-mode",
    path: "LICENSE",
    mode: 0o644,
    expectedMode: 0o755,
  });
  const disable = await feature.checkDisable(
    context(file("Apache 2026 Ada\nterms\n")),
  );
  if (disable.result !== "allowed") throw new Error("expected disable");
  assertEquals(
    (await feature.planDisable(
      context(file("Apache 2026 Ada\nterms\n")),
      disable,
    )).changes[0].kind,
    "remove-file",
  );
});

Deno.test("license replacement only lets the newly selected provider write LICENSE", async () => {
  const apacheFeature = createLicenseApache20Feature(
    source(apache),
    source(mit),
  );
  const mitFeature = createLicenseMitFeature(source(mit), source(apache));
  const changes: readonly ResolvedFeatureChange[] = [{
    featureId: "license-apache-2.0",
    enabled: true,
    reason: { kind: "explicit-request" },
  }, {
    featureId: "license-mit",
    enabled: false,
    reason: {
      kind: "exclusive-provider-replacement",
      capabilityId: "license",
      replacedBy: "license-apache-2.0",
    },
  }];
  const current = context(
    file("MIT 2025 Grace\nterms\n"),
    { licenseHolder: "Ada", licenseYear: "2026" },
    undefined,
    changes,
  );
  const apacheCheck = await apacheFeature.checkEnable(current);
  const mitCheck = await mitFeature.checkDisable(current);
  if (apacheCheck.result !== "allowed" || mitCheck.result !== "allowed") {
    throw new Error("expected replacement");
  }
  assertEquals(
    (await apacheFeature.planEnable(current, apacheCheck)).changes[0],
    {
      kind: "write-file",
      path: "LICENSE",
      content: "Apache 2026 Ada\nterms\n",
      mode: 0o644,
      expectedDigest: "digest",
    },
  );
  assertEquals((await mitFeature.planDisable(current, mitCheck)).changes, []);
  const reverse: readonly ResolvedFeatureChange[] = [{
    featureId: "license-mit",
    enabled: true,
    reason: { kind: "explicit-request" },
  }, {
    featureId: "license-apache-2.0",
    enabled: false,
    reason: {
      kind: "exclusive-provider-replacement",
      capabilityId: "license",
      replacedBy: "license-mit",
    },
  }];
  const apacheCurrent = context(
    file("Apache 2025 Grace\nterms\n"),
    { licenseHolder: "Ada", licenseYear: "2026" },
    undefined,
    reverse,
  );
  const reverseEnable = await mitFeature.checkEnable(apacheCurrent);
  const reverseDisable = await apacheFeature.checkDisable(apacheCurrent);
  if (
    reverseEnable.result !== "allowed" || reverseDisable.result !== "allowed"
  ) throw new Error("expected reverse replacement");
  assertEquals(
    (await mitFeature.planEnable(apacheCurrent, reverseEnable)).changes[0].kind,
    "write-file",
  );
  assertEquals(
    (await apacheFeature.planDisable(apacheCurrent, reverseDisable)).changes,
    [],
  );
});

const failing = () => Promise.reject(new Error("offline"));
function source(value: string) {
  return () => Promise.resolve(value);
}
function context(
  observation: ArtifactObservation,
  options = {},
  repair: OperationContext["repair"] = undefined,
  resolvedChanges: OperationContext["resolvedChanges"] = [],
): OperationContext {
  return {
    repositoryRoot: new URL("file:///tmp/opencode/license/"),
    files: {
      observe: (path) =>
        Promise.resolve(
          path === "LICENSE"
            ? observation
            : path === "README.md"
            ? readme(observation)
            : { kind: "absent" },
        ),
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
    resolvedChanges,
    repair,
    options,
  };
}
function file(content: string, mode = 0o644): ArtifactObservation {
  return { kind: "file", content, digest: "digest", mode };
}
function readme(observation: ArtifactObservation): ArtifactObservation {
  if (observation.kind !== "file") return { kind: "absent" };
  const label = observation.content.startsWith("Apache") ? "Apache-2.0" : "MIT";
  return file(`## License\n\n[${label}](./LICENSE)\n\n`);
}
