import { assertEquals, assertThrows } from "@std/assert";
import { getNextVersion, Logger } from "fork-version";
import type { Config, ForkConfig } from "fork-version";
import { nextVersion } from "./fork-version.ts";
import { releaseBranch, releaseCommitSubject } from "./names.ts";
import { selectPreviousRelease } from "./previous-release.ts";
import { selectReleaseType } from "./release-type.ts";
import { compareSemver, parseSemver } from "./semver.ts";
import { selectVersionFileProvider } from "./version-file-provider.ts";

Deno.test("release names remain fixed", () => {
  assertEquals(releaseBranch("1.2.3"), "release-1.2.3");
  assertEquals(releaseCommitSubject("1.2.3"), "chore(release): 1.2.3");
});

Deno.test("selects one version-file provider", async () => {
  const selected = await selectVersionFileProvider([{
    id: "deno",
    versionFile: () => Promise.resolve({ path: "deno.json", version: "1.0.0" }),
  }]);
  assertEquals(selected.kind, "selected");
  assertEquals((await selectVersionFileProvider([])).kind, "missing");
  const ambiguous = await selectVersionFileProvider([{
    id: "b",
    versionFile: () => Promise.resolve({ path: "b.json", version: "1.0.0" }),
  }, {
    id: "a",
    versionFile: () => Promise.resolve({ path: "a.json", version: "1.0.0" }),
  }]);
  if (ambiguous.kind !== "ambiguous") {
    throw new Error("test setup requires ambiguous providers");
  }
  assertEquals(ambiguous.providerIds, ["a", "b"]);
});

Deno.test("selects the greatest applicable previous tag and detects precedence conflicts", () => {
  assertEquals(
    selectPreviousRelease([{
      name: "1.2.0",
      target: "a",
      lightweight: true,
      targetIsAncestor: true,
    }, {
      name: "2.0.0",
      target: "b",
      lightweight: false,
      targetIsAncestor: true,
    }, {
      name: "1.3.0",
      target: "c",
      lightweight: true,
      targetIsAncestor: false,
    }], "1.2.0"),
    {
      kind: "tag",
      tag: {
        name: "1.2.0",
        target: "a",
        lightweight: true,
        targetIsAncestor: true,
      },
    },
  );
  assertEquals(selectPreviousRelease([], "0.1.0"), {
    kind: "baseline",
    version: "0.1.0",
    tag: null,
    target: null,
  });
  assertEquals(
    selectPreviousRelease([{
      name: "1.2.3+a",
      target: "a",
      lightweight: true,
      targetIsAncestor: true,
    }, {
      name: "1.2.3+b",
      target: "b",
      lightweight: true,
      targetIsAncestor: true,
    }], "0.1.0").kind,
    "conflict",
  );
  assertThrows(() => selectPreviousRelease([], "v1.0.0"), TypeError);
  assertEquals(
    selectPreviousRelease([{
      name: "1.2.3",
      target: "a",
      lightweight: true,
      targetIsAncestor: true,
    }], "1.2.2").kind,
    "version-mismatch",
  );
});

Deno.test("SemVer parsing is exact and compares arbitrary-size identifiers", () => {
  assertEquals(parseSemver("1.2.3-"), undefined);
  assertEquals(parseSemver("1.2.3-01"), undefined);
  const lower = parseSemver("999999999999999999999999.0.0")!;
  const higher = parseSemver("1000000000000000000000000.0.0")!;
  assertEquals(compareSemver(lower, higher), -1);
});

Deno.test("validated Conventional Commits select the greatest release type", () => {
  assertEquals(selectReleaseType([]), undefined);
  assertEquals(selectReleaseType([{ type: "fix", breaking: false }]), "patch");
  assertEquals(
    selectReleaseType([{ type: "feat", breaking: false }, {
      type: "fix",
      breaking: false,
    }]),
    "minor",
  );
  assertEquals(
    selectReleaseType([{ type: "feat", breaking: false }, {
      type: "fix",
      breaking: true,
    }]),
    "major",
  );
});

Deno.test("fork-version adapter matches fork-version 5.2.0 for stable, prerelease, and build versions", async () => {
  for (
    const [currentVersion, releaseAs] of [
      ["1.2.3", "minor"],
      ["1.2.3-beta.2", "patch"],
      ["1.2.3+build.7", "patch"],
    ] as const
  ) {
    const config: Config = { currentVersion, releaseAs, silent: true };
    const resolved = config as ForkConfig;
    const direct = await getNextVersion(
      resolved,
      new Logger(resolved),
      [],
      currentVersion,
    );
    assertEquals(await nextVersion(currentVersion, releaseAs), direct.version);
  }
});
