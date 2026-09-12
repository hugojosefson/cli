import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { createReleaseSection } from "./changelog.ts";

const hash = "1234567890abcdef1234567890abcdef12345678";
const commit = (message: string) => ({ hash, message });
const link = `[1234567](https://github.com/example/tool/commit/${hash})`;

test("changelog groups all types and scopes without repeated prefixes or lost reverts", async () => {
  const messages = [
    "docs(z): document",
    "feat(z): add z",
    "fix: repair",
    "feat(a): add a",
    "feat: unscoped",
    "fix(a)!: remove old",
    "revert: undo change",
    "custom-type: retain custom",
    "chore: maintenance",
    "feat(a): add second",
  ];
  const output = await createReleaseSection(
    "1.2.0",
    messages.map(commit),
    "example/tool",
  );
  assertEquals(
    output,
    `## 1.2.0

### BREAKING CHANGE

#### a

- remove old (${link})

### Features

- unscoped (${link})

#### a

- add a (${link})
- add second (${link})

#### z

- add z (${link})

### Fixes

- repair (${link})

### Other

- undo change (${link})
- retain custom (${link})
- maintenance (${link})

#### z

- document (${link})

`,
  );
  assertEquals(
    await createReleaseSection("1.2.0", messages.map(commit), "example/tool"),
    output,
  );
});

test("changelog links headers, bodies and footers without changing existing Markdown links", async () => {
  const output = await createReleaseSection("2.0.0", [commit(
    "fix(cli): handle #36 and [#5](https://github.com/example/tool/issues/5)\n\nSee other/project#7 and #8.\n\nBREAKING CHANGE: Replace #9 with #36.\n\nCloses #8",
  )], "example/tool");
  assertEquals(
    output,
    `## 2.0.0

### BREAKING CHANGE

#### cli

- handle [#36](https://github.com/example/tool/issues/36) and [#5](https://github.com/example/tool/issues/5) (${link}, [other/project#7](https://github.com/other/project/issues/7), [#8](https://github.com/example/tool/issues/8))

  Replace [#9](https://github.com/example/tool/issues/9) with [#36](https://github.com/example/tool/issues/36).

`,
  );
  const hyphen = await createReleaseSection("2.0.0", [
    commit(
      "refactor: replace\n\nBREAKING-CHANGE: Old API removed\nUse the new API.",
    ),
  ], "example/tool");
  assertStringIncludes(hyphen, "### BREAKING CHANGE");
  assertStringIncludes(hyphen, "  Old API removed\n  Use the new API.");
});

test("changelog rejects ambiguous identity, invalid versions, hashes and messages", async () => {
  for (
    const repository of [
      "",
      "../repo",
      "owner/..",
      "owner/repo/extra",
      "https://github.com/owner/repo",
    ]
  ) {
    await assertRejects(
      () => createReleaseSection("1.0.0", [commit("fix: one")], repository),
      TypeError,
    );
  }
  for (
    const commits of [[], [{ hash: "1234567", message: "fix: one" }], [
      commit("invalid"),
    ]]
  ) {
    await assertRejects(
      () => createReleaseSection("1.0.0", commits, "example/tool"),
      TypeError,
    );
  }
  await assertRejects(
    () => createReleaseSection("v1.0.0", [commit("fix: one")], "example/tool"),
    TypeError,
  );
});

test("release insertion preserves titles, arbitrary text and fenced examples", async () => {
  const { createChangelogInsertion, applyChangelogInsertion } = await import(
    "./changelog.ts"
  );
  const section = "## 1.0.0\n\n### Features\n\n- Add\n\n";
  for (
    const old of [
      "# Changelog\n",
      "# History",
      "plain text without headings",
      "# History\n\n```md\n## example\n```\n\n## Earlier\n\ncustom\n",
    ]
  ) {
    const insertion = createChangelogInsertion(old, section);
    const result = applyChangelogInsertion(old, insertion);
    assertEquals(
      result.slice(0, insertion.offset) +
        result.slice(insertion.offset + insertion.text.length),
      old,
    );
    if (old.startsWith("# ")) {
      assertEquals(result.startsWith(old.split("\n")[0]), true);
    }
    if (old.includes("```")) {
      assertStringIncludes(result, "```md\n## example\n```\n\n## 1.0.0");
    }
  }
});

test("release insertion ignores headings and fences inside HTML comments", async () => {
  const { createChangelogInsertion, applyChangelogInsertion } = await import(
    "./changelog.ts"
  );
  const old =
    "# Changelog\n\n<!--\n## 1.0.0\n```md\n-->\n\n## 0.1.0\n\nExisting history\n";
  const section = "## 1.0.0\n\n### Features\n\n- New entry\n\n";
  const insertion = createChangelogInsertion(old, section);
  assertEquals(insertion.offset, old.indexOf("## 0.1.0"));
  assertEquals(
    applyChangelogInsertion(old, insertion),
    old.replace("## 0.1.0", section + "## 0.1.0"),
  );
});

test("legacy recovery retains the original insertion offset inside comment examples", async () => {
  const {
    createChangelogInsertion,
    createLegacyChangelogInsertion,
    applyChangelogInsertion,
  } = await import("./changelog.ts");
  const old =
    "# Changelog\n\n<!--\n## Example\n-->\n\n## 0.0.1\n\n- docs: prior\n";
  const section = "## 0.0.2\n\n- fix: old release\n\n";
  const legacy = createLegacyChangelogInsertion(old, section);
  assertEquals(legacy.offset, old.indexOf("## Example"));
  assertEquals(
    createChangelogInsertion(old, section).offset,
    old.indexOf("## 0.0.1"),
  );
  assertEquals(
    applyChangelogInsertion(old, legacy),
    old.replace("## Example", section + "## Example"),
  );
});
