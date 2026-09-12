import { assert, assertStringIncludes } from "@std/assert";
import { describeFileRepair } from "./describe-file-repair.ts";

Deno.test("workflow repair names only changed jobs, permissions and steps", () => {
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

Deno.test("file repair identifies exact text additions, removals and movement without exposing prior contents", () => {
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

Deno.test("JSON repair handles creation, formatting, invalid input, and array removals", () => {
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
