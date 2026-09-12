import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { badgeLayoutResolution, layoutBadges } from "./badge-layout.ts";
import {
  inspectContribution,
  reconcileBlocks,
  rehashBlocks,
  unchangedBlocks,
} from "./contribution-blocks.ts";

const badge = (name: string) =>
  `[![${name}](https://example.org/${name}-badge.svg)](https://example.org/${name})`;
const item = (id: string) => ({
  id: id + ":badge",
  position: "badges" as const,
  content: badge(id),
});

test("badges form one ordered row after the first paragraph and before a table", async () => {
  const intro = "A first paragraph with\na second line.";
  const table = "| Area | Details |\n| --- | --- |\n| Code | Tools |";
  const custom = badge("custom");
  const original = `# Project\n\n${custom}\n\n${intro}\n\n${table}\n`;
  const desired = [
    item("github-ci"),
    item("github-release-publish-npm"),
    item("jsr-package"),
    item("github-release-publish-github"),
    item("z-other"),
  ];
  const result = await reconcileBlocks(original, desired);
  const line = result.split("\n").find((line) => line.includes("[!["))!;
  const expected = [
    "github-release-publish-github",
    "jsr-package",
    "github-release-publish-npm",
    "github-ci",
    "z-other",
    "custom",
  ];
  assertEquals(
    result.split("\n").filter((line) => line.includes("[![")).length,
    1,
  );
  assertEquals(
    [...line.matchAll(/!\[([^\]]+)\]/g)].map((match) => match[1]),
    expected,
  );
  assert(result.indexOf(intro) < result.indexOf(line));
  assert(result.indexOf(line) < result.indexOf(table));
  assertEquals(
    await unchangedBlocks(result),
    new Set(desired.map((item) => item.id)),
  );
  assertEquals(await reconcileBlocks(result, desired), result);
  assertEquals(layoutBadges(result), result);
  assertStringIncludes(
    badgeLayoutResolution(result, "README.md"),
    "jsr-package; github-release-publish-npm",
  );
});

test("inline ownership can be inspected, updated, rehashed and disabled independently", async () => {
  const first = item("github-release-publish-npm");
  const second = item("github-ci");
  const original = await reconcileBlocks("# Project\n\nIntro.\n", [
    first,
    second,
  ]);
  assertStringIncludes(
    original,
    "<!-- /hj:readme --> <!-- hj:readme github-ci:badge",
  );
  assertEquals(await inspectContribution(original, second), "exact");
  const changed = { ...second, content: badge("new-ci") };
  const updated = await reconcileBlocks(original, [changed], "github-ci");
  assertEquals(await inspectContribution(updated, first), "exact");
  assertEquals(await inspectContribution(updated, changed), "exact");
  const edited = updated.replace("new-ci-badge.svg", "custom-ci-badge.svg");
  assertEquals(await inspectContribution(edited, changed), "custom");
  assertEquals(await reconcileBlocks(edited, [changed], "github-ci"), edited);
  const rehashed = await rehashBlocks(edited, new Set([second.id]));
  assertEquals(await unchangedBlocks(rehashed), new Set([first.id, second.id]));
  const removed = await reconcileBlocks(updated, [], "github-ci");
  assertEquals(await inspectContribution(removed, first), "exact");
  assertEquals(await inspectContribution(removed, second), "absent");
  const empty = await reconcileBlocks(
    removed,
    [],
    "github-release-publish-npm",
  );
  assert(!empty.includes("hj:readme"));
  assert(!empty.includes("deno-fmt-ignore"));
});

test("legacy multiline badges migrate while code, comments and other owned sections stay intact", async () => {
  const desired = item("jsr-package");
  const owned = await reconcileBlocks("# Project\n\nIntro.\n", [desired]);
  const legacy = owned.replace(/<!-- deno-fmt-ignore-(?:start|end) -->\n/g, "")
    .replace(" <!-- /hj:readme -->", "\n\n<!-- /hj:readme -->");
  const examples = `\n\n~~~markdown\n${badge("fenced")}\n~~~\n\n\`${
    badge("inline")
  }\`\n\n<!-- ${badge("comment")} -->\n\n    ${badge("indented")}\n`;
  const result = layoutBadges(legacy + examples);
  assertStringIncludes(result, examples);
  assertEquals(await inspectContribution(result, desired), "exact");
  assertEquals(layoutBadges(result), result);
});

test("unowned badges preserve their links and order, including nested URL parentheses", () => {
  const one =
    "[![status](https://example.org/status(a).svg)](https://example.org/target(a))";
  const two = "![badge](https://img.shields.io/badge/two-blue)";
  const source =
    `# Project\n\n${one}\n\nIntro.\n\n## Other\n\n${two}\n\n![Screenshot](screen.png)\n`;
  const result = layoutBadges(source);
  assertStringIncludes(result, `${one} ${two}`);
  assertStringIncludes(result, "## Other\n\n![Screenshot](screen.png)");
  assertEquals(layoutBadges(result), result);
  assertEquals(layoutBadges("# Title\n"), "# Title\n");
  assertStringIncludes(layoutBadges(one + "\n"), one);
});

test("paragraph placement skips front matter, setext titles, comments and lists", () => {
  const prefix =
    "---\ntitle: Project\n---\n\nProject\n=======\n\n<!-- introduction -->\n\n- a list\n\n";
  const source = `${prefix}Introduction.\n\nSecond paragraph.\n\n${
    badge("custom")
  }\n`;
  const result = layoutBadges(source);
  assert(result.indexOf("Introduction.") < result.indexOf("[!["));
  assert(result.indexOf("[![") < result.indexOf("Second paragraph."));
  assertStringIncludes(result, prefix);
});

test("reference and HTML badges move together while linked screenshots stay in their section", () => {
  const screenshot =
    "[![Example screen](images/example.svg)](images/example.svg)";
  const reference = "[![Quality][quality-image]][quality-link]";
  const html =
    '<a href="https://example.org"><img alt="CI" src="https://example.org/build.svg"></a>';
  const definitions =
    "[quality-image]: https://img.shields.io/badge/quality-passing-green\n[quality-link]: https://example.org/quality";
  const source =
    `# Title\n\n${html}\n\nIntro.\n\n## Example\n\n${screenshot}\n\n${reference}\n\n${definitions}\n`;
  const result = layoutBadges(source);
  assertStringIncludes(result, `${html} ${reference}`);
  assertStringIncludes(result, `## Example\n\n${screenshot}`);
  assertStringIncludes(result, definitions);
  assertEquals(layoutBadges(result), result);
});

test("moving badges preserves deliberate blank lines in unrelated prose and code", () => {
  const suffix =
    "## Example\n\nCustom paragraph.\n\n\nAnother paragraph.\n\n```ts\nconst a = 1;\n\n\nconst b = 2;\n```\n";
  const source = `# Title\n\n${badge("custom")}\n\nIntro.\n\n${suffix}`;
  assertStringIncludes(layoutBadges(source), suffix);
});
