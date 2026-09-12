import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import { assert, assertStringIncludes } from "@std/assert";
import { describeFileRepair } from "./describe-file-repair.ts";

test("workflow repair names only changed jobs, permissions and steps", () => {
  const old =
    `name: CI\npermissions:\n  contents: write\njobs:\n  check:\n    steps:\n      - run: custom command with a preserved secret\n      - run: deno task old\n`;
  const desired = old.replace("contents: write", "contents: read").replace(
    "deno task old",
    "deno task ci",
  );
  const details = describeFileRepair(
    ".github/workflows/hj-ci.yaml",
    old,
    desired,
  ).join("\n");
  assertStringIncludes(
    details,
    '.github/workflows/hj-ci.yaml: permissions.contents = "read"',
  );
  assertStringIncludes(details, 'jobs.check.steps[1].run = "deno task ci"');
  assert(!details.includes("preserved secret"));
  assert(!details.includes("name ="));
});

test("file repair identifies exact text additions, removals and movement without exposing prior contents", () => {
  const old = "custom secret line\n# managed\nmanaged-pattern\nkeep\n";
  const desired = "keep\n# managed\nmanaged-pattern\nnew-pattern\n";
  const details = describeFileRepair(".gitignore", old, desired).join("\n");
  assertStringIncludes(details, "Remove .gitignore line 1");
  assertStringIncludes(
    details,
    "original lines 4, 2, 3 must appear in that order",
  );
  assertStringIncludes(details, "Add .gitignore line 4: new-pattern");
  assert(!details.includes("custom secret line"));
  const added = describeFileRepair(
    "generated.txt",
    undefined,
    'password="do-not-print"\nAuthorization: Bearer another-secret\n',
  ).join("\n");
  assert(!added.includes("do-not-print"));
  assert(!added.includes("another-secret"));
  assertStringIncludes(added, "[redacted]");
  assertStringIncludes(
    describeFileRepair("file.txt", "keep\r\n", "keep\n")[0],
    "Normalize line endings",
  );
});

test("JSON repair handles creation, formatting, invalid input, and array removals", () => {
  assertStringIncludes(
    describeFileRepair("deno.json", undefined, '{"lock":true}')[0],
    "lock = true",
  );
  const formatted = describeFileRepair(
    "deno.jsonc",
    '{"lock":true}',
    '{\n"lock": true\n}',
  ).join("\n");
  assertStringIncludes(
    formatted,
    "Preserve all configuration values in deno.jsonc",
  );
  const comments = describeFileRepair(
    "ci.yaml",
    "# custom comment\nname: CI\n",
    "name: CI\n",
  ).join("\n");
  assertStringIncludes(comments, "Remove ci.yaml line 1");
  assertStringIncludes(comments, "Preserve all configuration values");
  assertStringIncludes(
    describeFileRepair("deno.json", "not json", '{"lock": true}').join("\n"),
    "Remove deno.json line 1",
  );
  assertStringIncludes(
    describeFileRepair("bad.yaml", "a: [", "a: [\n").join("\n"),
    "Add bad.yaml line 2",
  );
  assertStringIncludes(
    describeFileRepair(
      "deno.json",
      '{"items":[{"value":1},{"value":2}]}',
      '{"items":[{"value":1}]}',
    ).join("\n"),
    "remove items[1]",
  );
});

test("workflow cache insertion and removal omit retained steps and describe neighboring edits", () => {
  const retained = [
    { name: "Configure authentication", run: "preserved private command" },
    {
      id: "prepare",
      env: { GH_TOKEN: "preserved-private-value" },
      run: "prepare",
    },
  ];
  const old = [{ uses: "setup@old", with: { version: "1" } }, ...retained];
  const cache = {
    name: "Cache dependencies",
    uses: "cache@pin",
    with: { path: "~/.npm" },
    env: { TOKEN: "new-private-value" },
  };
  const desired = [
    { uses: "setup@new", with: { version: "2" } },
    cache,
    ...retained,
  ];
  const workflow = (steps: unknown[]) =>
    JSON.stringify({ jobs: { check: { steps } } });
  const details = describeFileRepair(
    "ci.yaml",
    workflow(old),
    workflow(desired),
  ).join("\n");
  assertStringIncludes(details, 'jobs.check.steps[0].uses = "setup@new"');
  assertStringIncludes(details, 'jobs.check.steps[0].with.version = "2"');
  assertStringIncludes(details, 'jobs.check.steps[1].with.path = "~/.npm"');
  assertStringIncludes(details, "jobs.check.steps[1].env.TOKEN = [redacted]");
  for (
    const preserved of [
      "Configure authentication",
      "preserved private command",
      "prepare",
      "preserved-private-value",
      "new-private-value",
      "remove",
      "reorder",
    ]
  ) {
    assert(!details.includes(preserved));
  }
  const removal = describeFileRepair(
    "ci.yaml",
    workflow(desired),
    workflow([desired[0], ...retained]),
  );
  assert(removal.length === 1);
  assertStringIncludes(removal[0], "remove jobs.check.steps[1]");
  const empty = describeFileRepair("ci.yaml", workflow([cache]), workflow([]));
  assert(empty.length === 1);
  assertStringIncludes(empty[0], "remove jobs.check.steps[0]");
});

test("workflow repair retains duplicate occurrences and reports reordered edited steps", () => {
  const workflow = (steps: unknown[]) =>
    JSON.stringify({ jobs: { check: { steps } } });
  const old = [
    { run: "preserved private command" },
    { run: "duplicate command" },
    { run: "duplicate command" },
    { id: "edit", run: "old command", env: { PASSWORD: "old-private-value" } },
  ];
  const desired = [old[1], old[0], old[2], {
    id: "edit",
    run: "new command",
    env: { PASSWORD: "new-private-value" },
  }];
  const details = describeFileRepair(
    "ci.yaml",
    workflow(old),
    workflow(desired),
  ).join("\n");
  assertStringIncludes(
    details,
    "reorder retained jobs.check.steps: original indices 1, 0 must appear in that order",
  );
  assertStringIncludes(details, 'jobs.check.steps[3].run = "new command"');
  assertStringIncludes(
    details,
    "jobs.check.steps[3].env.PASSWORD = [redacted]",
  );
  for (
    const preserved of [
      "preserved private command",
      "duplicate command",
      "old-private-value",
      "new-private-value",
    ]
  ) {
    assert(!details.includes(preserved));
  }
  const anonymous = describeFileRepair(
    "ci.yaml",
    workflow([{ run: "old anonymous" }, old[0]]),
    workflow([old[0], { run: "new anonymous" }]),
  ).join("\n");
  assertStringIncludes(anonymous, 'jobs.check.steps[1].run = "new anonymous"');
  assertStringIncludes(
    anonymous,
    "original indices 1, 0 must appear in that order",
  );
  assert(!anonymous.includes("preserved private command"));
});
