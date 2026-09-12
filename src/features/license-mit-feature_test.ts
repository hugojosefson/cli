import { test as nativeTest } from "node:test";
import { testStep, trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import { assertEquals, assertStringIncludes } from "@std/assert";
import type { ArtifactObservation } from "../api/artifact-inspection.ts";
import type { OperationContext } from "../api/repository-context.ts";
import { createLicenseApache20Feature } from "./license-apache-2.0-feature.ts";
import { createLicenseMitFeature } from "./license-mit-feature.ts";

const template = "Copyright <year> <copyright holders>\nterms\n";
const apacheTemplate = "Apache [yyyy] [name of copyright owner]\nterms\n";

test("MIT provider detects exact, drifted, and ambiguous LICENSE files", async () => {
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

test("MIT detection tolerates checkout permissions but rejects executable or read-only files", async () => {
  const feature = createLicenseMitFeature(
    source(template),
    source(apacheTemplate),
  );
  for (const mode of [0o600, 0o640, 0o644, 0o660, 0o664, 0o666, 0o645]) {
    const current = context(file("Copyright 2026 Ada\nterms\n", mode));
    assertEquals((await feature.detect(current)).state, "enabled");
    assertEquals((await feature.checkEnable(current)).result, "no-op");
  }
  for (const mode of [0o444, 0o755, 0o200]) {
    assertEquals(
      (await feature.detect(context(file("Copyright 2026 Ada\nterms\n", mode))))
        .state,
      "drifted",
    );
  }
});

test("MIT provider writes resolved attribution and repairs only mode drift", async () => {
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
      mode: 0o655,
      expectedMode: 0o755,
    },
  );
});

test("MIT provider removes only exact downloaded content", async () => {
  const feature = createLicenseMitFeature(
    source(template),
    source(apacheTemplate),
  );
  const exact = context(file("Copyright 2026 Ada\nterms\n"));
  const check = await feature.checkDisable(exact);
  assertEquals(check.result, "allowed");
  if (check.result !== "allowed") throw new Error("expected disable");
  assertEquals((await feature.planDisable(exact, check)).changes[0], {
    kind: "remove-file",
    path: "LICENSE",
    expectedDigest: "digest",
  });
  assertEquals(
    (await feature.checkDisable(
      context(file("Copyright 2026 Ada\ncustom\n")),
    )).result,
    "blocked",
  );
});

test("MIT provider does not download while LICENSE is absent", async () => {
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
    resolvedChanges: [],
    repair,
    options,
  };
}

function file(content: string, mode = 0o644): ArtifactObservation {
  return { kind: "file", content, digest: "digest", mode };
}
function readme(observation: ArtifactObservation): ArtifactObservation {
  if (observation.kind !== "file") return { kind: "absent" };
  const label =
    /^(?:Copyright|MIT License)/.test(observation.content.trimStart())
      ? "MIT"
      : "Apache-2.0";
  return file(`## License\n\n[${label}](./LICENSE)\n`);
}

function source(value: string) {
  return () => Promise.resolve(value);
}

// Pinned SPDX MIT text and the reported repository LICENSE, respectively.
const mitTemplate = `MIT License

Copyright (c) <year> <copyright holders>

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the
following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial
portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO
EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
USE OR OTHER DEALINGS IN THE SOFTWARE.
`;
const reportedMit = `MIT License

Copyright © 2025 Hugo Josefson

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
`;

test("MIT recognizes equivalent copyright markers and line formatting without rewriting", async (t) => {
  const canonical = mitTemplate.replace("<year>", "2025").replace(
    "<copyright holders>",
    "Hugo Josefson",
  );
  const cases = new Map([
    ["copyright marker only", canonical.replace("(c)", "©")],
    ["line wrapping only", reportedMit.replace("©", "(c)")],
    ["reported copyright and wrapping", reportedMit],
    ["CRLF", reportedMit.replaceAll("\n", "\r\n")],
    ["missing final newline", reportedMit.trimEnd()],
    [
      "blank lines and surrounding whitespace",
      `\n${reportedMit.replaceAll("\n\n", "\n\n\n")}\n`,
    ],
    ["single line", canonical.replaceAll(/\s+/g, " ").trim()],
  ]);
  for (const [name, content] of cases) {
    await testStep(t, name, async () => {
      const feature = createLicenseMitFeature(
        source(mitTemplate),
        source(apacheTemplate),
      );
      const current = context(file(content));
      assertEquals((await feature.detect(current)).state, "enabled");
      assertEquals((await feature.checkEnable(current)).result, "no-op");
      const drift = context(file(content, 0o444), {}, {
        kind: "features",
        featureIds: ["license-mit"],
      });
      const repair = await feature.checkEnable(drift);
      if (repair.result !== "allowed") throw new Error("expected repair");
      const plan = await feature.planEnable(drift, repair);
      assertEquals(plan.changes, [{
        kind: "set-file-mode",
        path: "LICENSE",
        mode: 0o644,
        expectedMode: 0o444,
      }]);
      assertEquals(plan.preconditions, [{
        kind: "file-digest",
        path: "LICENSE",
        digest: "digest",
      }]);
    });
  }
  const symbolTemplate = createLicenseMitFeature(
    source(mitTemplate.replace("(c)", "©")),
    source(apacheTemplate),
  );
  assertEquals(
    (await symbolTemplate.detect(context(file(canonical)))).state,
    "enabled",
  );
});

test("MIT rejects substantive edits and unsafe attribution despite equivalent formatting", async (t) => {
  const feature = createLicenseMitFeature(
    source(mitTemplate),
    source(apacheTemplate),
  );
  const cases = new Map([
    ["changed terms", reportedMit.replace("free of charge", "for a fee")],
    ["missing terms", reportedMit.replace("sublicense, ", "")],
    [
      "added terms",
      reportedMit.replace(
        "subject to the following conditions:",
        "subject to the following conditions: Payment is required.",
      ),
    ],
    [
      "added paragraph after holder",
      reportedMit.replace(
        "Hugo Josefson",
        "Hugo Josefson\nPayment is required.",
      ),
    ],
    ["added trailing terms", reportedMit + "Payment is required.\n"],
    ["invalid year", reportedMit.replace("2025", "25")],
    ["missing holder", reportedMit.replace("Hugo Josefson", "")],
    [
      "multiline holder",
      reportedMit.replace("Hugo Josefson", "Hugo\nJosefson"),
    ],
    ["CRLF holder", reportedMit.replace("Hugo Josefson", "Hugo\r\nJosefson")],
    ["slash in holder", reportedMit.replace("Hugo Josefson", "Hugo/Josefson")],
    [
      "backslash in holder",
      reportedMit.replace("Hugo Josefson", "Hugo\\Josefson"),
    ],
    ["NUL in holder", reportedMit.replace("Hugo Josefson", "Hugo\0Josefson")],
    ["dot holder", reportedMit.replace("Hugo Josefson", ".")],
    ["parent holder", reportedMit.replace("Hugo Josefson", "..")],
    ["joined words", reportedMit.replace("free of", "freeof")],
  ]);
  for (const [name, content] of cases) {
    await testStep(t, name, async () => {
      const current = context(file(content));
      assertEquals((await feature.detect(current)).state, "ambiguous");
      assertEquals((await feature.checkEnable(current)).result, "blocked");
      assertEquals((await feature.checkDisable(current)).result, "blocked");
    });
  }
});

test("alternate providers recognize equivalent MIT text and guard replacement with its digest", async () => {
  const feature = createLicenseApache20Feature(
    source(apacheTemplate),
    source(mitTemplate),
  );
  const current = context(file(reportedMit), {
    licenseHolder: "Ada",
    licenseYear: "2026",
  });
  assertEquals((await feature.detect(current)).state, "disabled");
  const check = await feature.checkEnable(current);
  if (check.result !== "allowed") throw new Error("expected replacement");
  const plan = await feature.planEnable(current, check);
  assertEquals(plan.preconditions, [{
    kind: "file-digest",
    path: "LICENSE",
    digest: "digest",
  }]);
  assertEquals(plan.changes[0], {
    kind: "write-file",
    path: "LICENSE",
    content: "Apache 2026 Ada\nterms\n",
    mode: 0o644,
    expectedDigest: "digest",
  });
  assertEquals(
    (await feature.detect(
      context(file(reportedMit.replace("free of charge", "for a fee"))),
    )).state,
    "ambiguous",
  );
});

test("recognized MIT text reports the README conflict and keeps alternate licenses disabled", async () => {
  const mit = createLicenseMitFeature(source(template), source(apacheTemplate));
  const apache = createLicenseApache20Feature(
    source(apacheTemplate),
    source(template),
  );
  for (
    const content of [
      "# Project\n\n## License\n\nMIT\n",
      "# Project\n\n## License\n\n[MIT](./LICENSE)\n\n## License\n\nMIT\n",
    ]
  ) {
    const base = context(file("Copyright 2026 Ada\nterms\n"));
    const current = {
      ...base,
      files: {
        ...base.files,
        observe: (path: string) =>
          path === "README.md"
            ? Promise.resolve(file(content))
            : base.files.observe(path),
      },
    };
    const detected = await mit.detect(current);
    assertEquals(detected.state, "ambiguous");
    if (detected.state !== "ambiguous") {
      throw new Error("expected README conflict");
    }
    assertEquals(detected.issues[0].subject.identifier, "README.md");
    assertStringIncludes(
      detected.issues[0].observation,
      "LICENSE matches MIT.",
    );
    assertStringIncludes(detected.issues[0].observation, "line");
    assertStringIncludes(detected.issues[0].resolution, "[MIT](./LICENSE)");
    assertEquals((await apache.detect(current)).state, "disabled");
    assertEquals((await apache.checkEnable(current)).result, "blocked");
    assertEquals((await mit.checkEnable(current)).result, "blocked");
  }
});

test("license template failures do not report a LICENSE content mismatch", async () => {
  const feature = createLicenseMitFeature(() =>
    Promise.reject(new Error("private-token"))
  );
  const detected = await feature.detect(
    context(file("Copyright 2026 Ada\nterms\n")),
  );
  if (detected.state !== "ambiguous") {
    throw new Error("expected unavailable template");
  }
  assertStringIncludes(
    detected.issues[0].observation,
    "template inspection is unavailable",
  );
  assertStringIncludes(
    detected.issues[0].resolution,
    "raw.githubusercontent.com",
  );
  assertEquals(JSON.stringify(detected).includes("private-token"), false);
});

test("license findings name the editable generated README source and exact duplicate lines", async () => {
  const mit = createLicenseMitFeature(source(template), source(apacheTemplate));
  const base = context(file("Copyright 2026 Ada\nterms\n"));
  const content = "# Project\n\n## License\n\nMIT\n\n## License\n\nMIT\n";
  const current = {
    ...base,
    files: {
      ...base.files,
      observe: (path: string) => {
        if (path === "readme") {
          return Promise.resolve({
            kind: "directory" as const,
            stateDigest: "directory",
          });
        }
        if (path === "readme/README.md") {
          return Promise.resolve(
            file(content),
          );
        }
        if (path === "README.md") return Promise.resolve(file(content, 0o444));
        return base.files.observe(path);
      },
    },
  };
  const detected = await mit.detect(current);
  if (detected.state !== "ambiguous") {
    throw new Error("expected README conflict");
  }
  assertEquals(detected.issues[0].subject.identifier, "readme/README.md");
  assertStringIncludes(
    detected.issues[0].observation,
    "duplicate ## License headings at lines 3, 7",
  );
  assertStringIncludes(detected.issues[0].resolution, "[MIT](../LICENSE)");
});
