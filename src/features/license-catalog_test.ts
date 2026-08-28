import { assertEquals, assertRejects } from "@std/assert";
import type { ArtifactObservation } from "../api/artifact-inspection.ts";
import type { OperationContext } from "../api/repository-context.ts";
import {
  licenseCatalog,
  licenseCatalogDefinitions,
} from "./license-catalog.ts";
import { createSpdxLicenseFeature } from "./license-spdx-feature.ts";
import { createSpdxTextSource } from "./license-spdx-source.ts";

const expected = new Map([
  ["license-gpl-2.0-only", ["year", "holder"]],
  ["license-gpl-3.0-only", ["year", "holder", "project"]],
  ["license-agpl-3.0-only", ["year", "holder"]],
  ["license-isc", ["year", "holder"]],
  ["license-bsd-2-clause", ["year", "holder"]],
  ["license-bsd-3-clause", ["year", "holder", "project"]],
  ["license-mpl-2.0", []],
  ["license-unlicense", []],
]);
const templateFiles = new Map([
  ["license-gpl-2.0-only", "gpl2"],
  ["license-gpl-3.0-only", "gpl3"],
  ["license-agpl-3.0-only", "agpl3"],
  ["license-isc", "isc"],
  ["license-bsd-2-clause", "bsd2"],
  ["license-bsd-3-clause", "bsd3"],
  ["license-mpl-2.0", "mpl"],
  ["license-unlicense", "unlicense"],
]);

Deno.test("catalog has pinned direct templates and exact declared replacements", async () => {
  for (const [id, definition] of licenseCatalogDefinitions) {
    const kinds = definition.placeholders.map(({ kind }) => kind);
    if (expected.has(id)) {
      assertEquals(kinds, expected.get(id));
      assertEquals(
        definition.url,
        `https://raw.githubusercontent.com/licenses/license-templates/aa0399cd31350a2692d0f51f651fc2fd3d0a5dab/templates/${
          templateFiles.get(id)
        }.txt`,
      );
    }
    const text = template(definition);
    assertEquals(
      await createSpdxTextSource(definition, (url) => {
        assertEquals(String(url), definition.url);
        return Promise.resolve(new Response(text));
      })(),
      text,
    );
  }
  const definition =
    licenseCatalog.find(({ id }) => id === "license-isc")!.definition;
  await assertRejects(() =>
    createSpdxTextSource(
      definition,
      () =>
        Promise.resolve(
          new Response("{{ year }} {{ organization }} {{ surprise }}"),
        ),
    )()
  );
});

Deno.test("every provider renders, detects, repairs, and directly disables exact content", async () => {
  for (const provider of licenseCatalog) {
    const text = template(provider.definition);
    const feature = createSpdxLicenseFeature({
      ...provider,
      text: source(text),
      alternates: [],
    });
    const absent = context({ kind: "absent" });
    const enable = await feature.checkEnable(absent);
    assertEquals(enable.result, "allowed", provider.id);
    if (enable.result !== "allowed") continue;
    const content = rendered(provider.definition);
    assertEquals((await feature.planEnable(absent, enable)).changes[0], {
      kind: "write-file",
      path: "LICENSE",
      content,
      mode: 0o644,
      expectedDigest: undefined,
    });
    assertEquals(
      (await feature.detect(context(file(content, 0o755)))).state,
      "drifted",
    );
    const arbitrary = context(file("tiny modified\n"));
    assertEquals(
      (await feature.detect(arbitrary)).state,
      "ambiguous",
      provider.id,
    );
    assertEquals(
      (await feature.checkDisable(arbitrary)).result,
      "blocked",
      provider.id,
    );
    const repair = await feature.checkEnable(
      context(file(content, 0o755), undefined, {
        kind: "features",
        featureIds: [provider.id],
      }),
    );
    assertEquals(repair.result, "allowed", provider.id);
    const disable = await feature.checkDisable(context(file(content)));
    assertEquals(disable.result, "allowed", provider.id);
    if (disable.result === "allowed") {
      assertEquals(
        (await feature.planDisable(context(file(content)), disable)).changes[0]
          ?.kind,
        "remove-file",
      );
    }
  }
});

Deno.test("catalog providers recognize every exact alternate and only new replacements write", async () => {
  for (
    const [oldId, newId] of [
      ["license-mit", "license-gpl-3.0-only"],
      ["license-gpl-3.0-only", "license-isc"],
      ["license-isc", "license-mpl-2.0"],
    ]
  ) {
    const old = licenseCatalog.find(({ id }) => id === oldId)!;
    const next = licenseCatalog.find(({ id }) => id === newId)!;
    const oldText = template(old.definition);
    const nextText = template(next.definition);
    const current = file(rendered(old.definition));
    const changes = [{
      featureId: newId,
      enabled: true,
      reason: { kind: "explicit-request" as const },
    }, {
      featureId: oldId,
      enabled: false,
      reason: {
        kind: "exclusive-provider-replacement" as const,
        capabilityId: "license",
        replacedBy: newId,
      },
    }];
    const oldFeature = createSpdxLicenseFeature({
      ...old,
      text: source(oldText),
      alternates: [{ ...next, text: source(nextText) }],
    });
    const nextFeature = createSpdxLicenseFeature({
      ...next,
      text: source(nextText),
      alternates: [{ ...old, text: source(oldText) }],
    });
    assertEquals(
      (await nextFeature.detect(context(current))).state,
      "disabled",
    );
    const operation = context(current, undefined, undefined, changes);
    const enable = await nextFeature.checkEnable(operation);
    const disable = await oldFeature.checkDisable(operation);
    if (enable.result !== "allowed" || disable.result !== "allowed") {
      throw new Error("expected replacement");
    }
    assertEquals(
      (await nextFeature.planEnable(operation, enable)).changes[0]?.kind,
      "write-file",
    );
    assertEquals(
      (await oldFeature.planDisable(operation, disable)).changes,
      [],
    );
  }
});

function template(
  definition: typeof licenseCatalog[number]["definition"],
): string {
  return `fixture-${definition.name} ${
    definition.placeholders.map(({ marker }) => marker).join(" ")
  }\n`;
}
function rendered(
  definition: typeof licenseCatalog[number]["definition"],
): string {
  return template(definition).replaceAll("{{ year }}", "2026").replaceAll(
    "{{ organization }}",
    "Ada",
  ).replaceAll("{{ project }}", "repo").replaceAll("<year>", "2026").replaceAll(
    "<copyright holders>",
    "Ada",
  ).replaceAll("[yyyy]", "2026").replaceAll("[name of copyright owner]", "Ada");
}
function source(value: string) {
  return () => Promise.resolve(value);
}
function context(
  observation: ArtifactObservation,
  options: OperationContext["options"] = {
    licenseHolder: "Ada",
    licenseYear: "2026",
  },
  repair: OperationContext["repair"] = undefined,
  resolvedChanges: OperationContext["resolvedChanges"] = [],
): OperationContext {
  return {
    repositoryRoot: new URL("file:///tmp/opencode/repo/"),
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
  const label = /^fixture-([^\s]+)/.exec(observation.content)?.[1] ?? "MIT";
  return file(`## License\n\n[${label}](./LICENSE)\n\n`);
}
