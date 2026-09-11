import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  applyChangelogInsertion,
  createChangelogInsertion,
  createReleaseSection,
} from "./changelog.ts";
import {
  parseConventionalCommit,
  validateConventionalCommits,
} from "./conventional-commit.ts";
import {
  githubOutputLimit,
  githubOutputSize,
  validateGithubOutputSize,
} from "./github-output.ts";
import {
  decodeReleaseBundle,
  encodeReleaseBundle,
  type ReleaseBundle,
  validateReleaseBundleFiles,
} from "./release-bundle.ts";
import {
  parseReleaseOwnershipMarker,
  releaseOwnershipMarker,
  releasePullRequestBody,
} from "./release-pr.ts";
import { updateDenoConfigVersion } from "./version-file.ts";

Deno.test("strict Conventional Commit validation rejects every malformed selected message", () => {
  assertEquals(
    parseConventionalCommit(
      "feat(api)!: add endpoint\n\nBREAKING CHANGE: old endpoint removed",
    ),
    {
      type: "feat",
      breaking: true,
      subject: "feat(api)!: add endpoint",
    },
  );
  assertThrows(() =>
    validateConventionalCommits(["fix: valid", "missing prefix"])
  );
  assertThrows(() =>
    validateConventionalCommits(["fix: valid\nbody without separator"])
  );
  assertThrows(() => validateConventionalCommits(["Fix: uppercase type"]));
});

Deno.test("version changes preserve JSON and JSONC source details", () => {
  assertEquals(
    updateDenoConfigVersion(
      "deno.json",
      '{\n  "version": "1.0.0"\n}\n',
      "1.1.0",
    ),
    '{\n  "version": "1.1.0"\n}\n',
  );
  assertEquals(
    updateDenoConfigVersion(
      "deno.jsonc",
      '{\n  // current\n  "version": "1.0.0",\n}\n',
      "2.0.0",
    ),
    '{\n  // current\n  "version": "2.0.0",\n}\n',
  );
  assertThrows(() => updateDenoConfigVersion("deno.json", "{}", "1.0.0"));
});

Deno.test("changelog inserts after its preamble without changing prior text", () => {
  const oldText = "# Changelog\n\nProject notes.\n\n## 1.0.0\n\n- First\n";
  const insertion = createChangelogInsertion(
    oldText,
    createReleaseSection("1.1.0", ["feat: add item"]),
  );
  assertEquals(insertion.offset, "# Changelog\n\nProject notes.\n\n".length);
  assertEquals(
    applyChangelogInsertion(oldText, insertion),
    "# Changelog\n\nProject notes.\n\n## 1.1.0\n\n- feat: add item\n\n## 1.0.0\n\n- First\n",
  );
});

Deno.test("release bundle is canonical, digest-checked, and path constrained", async () => {
  const versionText = '{"version":"1.1.0"}';
  const oldVersionText = '{"version":"1.0.0"}';
  const oldChangelogText = "# Changelog\n\n";
  const changelogInsertion = "## 1.1.0\n\n- feat: add item\n\n";
  const bundle: ReleaseBundle = {
    schema: 1,
    previousTag: "1.0.0",
    previousTagTarget: "a".repeat(40),
    selectedSha: "b".repeat(40),
    previousVersion: "1.0.0",
    nextVersion: "1.1.0",
    releaseType: "minor",
    versionFile: {
      path: "deno.json",
      previousDigest: await textDigest(oldVersionText),
      text: versionText,
      digest: await textDigest(versionText),
    },
    changelog: {
      path: "CHANGELOG.md",
      previousDigest: await textDigest(oldChangelogText),
      offset: 0,
      insertion: changelogInsertion,
      digest: await textDigest(changelogInsertion + oldChangelogText),
    },
    changedPaths: ["deno.json", "CHANGELOG.md"],
    treeDigest: "c".repeat(64),
  };
  const encoded = await encodeReleaseBundle(bundle);
  assertEquals(
    await decodeReleaseBundle(encoded.bundle, encoded.digest),
    bundle,
  );
  await validateReleaseBundleFiles(bundle, oldVersionText, oldChangelogText);
  await assertRejects(() =>
    decodeReleaseBundle(encoded.bundle, "0".repeat(64))
  );
  await assertRejects(() =>
    encodeReleaseBundle({
      ...bundle,
      changedPaths: ["CHANGELOG.md", "deno.json"],
    })
  );
});

Deno.test("GitHub output limit uses UTF-16 code units and permits exactly 1 MB", () => {
  assertEquals(githubOutputSize(["😀"]), 2);
  validateGithubOutputSize(["a".repeat(githubOutputLimit)]);
  assertThrows(() =>
    validateGithubOutputSize(["a".repeat(githubOutputLimit + 1)])
  );
});

Deno.test("release PR ownership marker and body are deterministic", () => {
  const ownership = {
    schema: 1 as const,
    selectedSha: "a".repeat(40),
    version: "1.2.3",
    branchHead: "b".repeat(40),
    treeDigest: "c".repeat(64),
  };
  const marker = releaseOwnershipMarker(ownership);
  assertEquals(parseReleaseOwnershipMarker(marker), ownership);
  assertEquals(
    releasePullRequestBody(ownership),
    releasePullRequestBody(ownership),
  );
  assertEquals(parseReleaseOwnershipMarker(`${marker}\n${marker}`), undefined);
});

function hex(buffer: ArrayBuffer): string {
  return Array.from(
    new Uint8Array(buffer),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function textDigest(text: string): Promise<string> {
  return hex(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );
}
