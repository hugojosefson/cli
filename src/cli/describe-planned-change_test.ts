import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import {
  makeTempDir,
  remove,
  writeTextFile,
} from "../testing/files-test-fixtures.ts";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import type { PlannedChange } from "../api/planned-change.ts";
import { LocalFileReader } from "../repository/local-file-reader.ts";
import { describePlannedChange } from "./describe-planned-change.ts";
import { describeConfiguration } from "./repair-configuration-description.ts";

test("repair configuration names changed commands, dependencies and rule values but omits preserved data and credentials", () => {
  const old = {
    tasks: {
      fmt: { command: "prettier --write ." },
      custom: { command: "confidential command" },
    },
    removeMe: "private previous value",
  };
  const result = describeConfiguration({
    tasks: {
      fmt: { command: "deno fmt", dependencies: ["build"] },
      custom: old.tasks.custom,
    },
    endpoint:
      "https://username:never-print@github.com/owner/repo?token=hidden-value",
    credentials: { token: "another-private-value" },
    rules: [{
      type: "required_status_checks",
      parameters: {
        strict_required_status_checks_policy: true,
        checks: [{ context: "check" }],
        secret: "hidden-in-array",
      },
    }],
    command: "deno run https://example.test/ghp_thisIsPrivate",
    nullable: null,
    count: 2,
  }, old).join("\n");
  for (
    const expected of [
      "tasks.fmt.command",
      "deno fmt",
      "dependencies",
      '"build"',
      "remove removeMe",
      "required_status_checks",
      "strict_required_status_checks_policy",
      '"check"',
      "[redacted]",
      "nullable = null",
      "count = 2",
    ]
  ) {
    assertStringIncludes(result, expected);
  }
  for (
    const omitted of [
      "confidential command",
      "private previous value",
      "never-print",
      "hidden-value",
      "another-private-value",
      "hidden-in-array",
      "ghp_thisIsPrivate",
    ]
  ) {
    assert(!result.includes(omitted), result);
  }
  assertEquals(describeConfiguration(old, old), []);
});

test("repair descriptions show file replacement, removals, permissions and remote resource settings", async () => {
  const path = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-describe-repair-",
  });
  const root = new URL(`file://${path}/`);
  const files = new LocalFileReader(root);
  try {
    await writeTextFile(
      new URL("config.txt", root),
      "keep\nkeep\nprivate-old-content\n",
    );
    const changed = await describePlannedChange({
      kind: "write-file",
      path: "config.txt",
      content: "keep\nreplacement\n",
      expectedDigest: "old",
    }, files);
    assertStringIncludes(changed, "Remove config.txt line 2");
    assertStringIncludes(changed, "Remove config.txt line 3");
    assertStringIncludes(changed, "Add config.txt line 2: replacement");
    assertStringIncludes(changed, "existing content");
    assert(!changed.includes("private-old-content"));
    const reordered = await describePlannedChange({
      kind: "write-file",
      path: "config.txt",
      content: "private-old-content\nkeep\nkeep\n",
      expectedDigest: "old",
    }, files);
    assertStringIncludes(
      reordered,
      "original lines 3, 1, 2 must appear in that order",
    );
    const changes: PlannedChange[] = [
      { kind: "create-directory", path: "generated" },
      {
        kind: "write-file",
        path: "generated/new.ts",
        content: "export const enabled = true;",
        expectedDigest: undefined,
        mode: 0o755,
      },
      {
        kind: "write-file",
        path: "default-mode.ts",
        content: "export const enabled = true;",
        expectedDigest: undefined,
      },
      { kind: "remove-file", path: "legacy.ts", expectedDigest: "old" },
      {
        kind: "remove-directory",
        path: "legacy-dir",
        expectedStateDigest: "old",
      },
      { kind: "create-symlink", path: "README.md", target: "readme/README.md" },
      { kind: "remove-symlink", path: "old-link", expectedTarget: "old" },
      {
        kind: "set-file-mode",
        path: "cli.ts",
        mode: 0o755,
        expectedMode: 0o644,
      },
      {
        kind: "set-json",
        path: "deno.json",
        jsonPath: ["lock"],
        value: true,
        expected: undefined,
      },
      {
        kind: "remove-json",
        path: "deno.json",
        jsonPath: ["legacy"],
        expected: "private",
      },
      { kind: "git-init", defaultBranch: "main" },
      { kind: "git-init" },
      {
        kind: "git-commit",
        message: "private",
        paths: ["deno.json"],
        allowEmpty: false,
      },
      { kind: "git-commit", message: "private", paths: [], allowEmpty: true },
      { kind: "create-git-branch", name: "repair" },
      {
        kind: "set-git-remote",
        name: "origin",
        url: "https://secret@github.com/owner/repo",
      },
      {
        kind: "upsert-github-resource",
        resource: "repository",
        name: "settings",
        definition: { allow_auto_merge: true },
        expectedStateDigest: "old",
      },
      {
        kind: "upsert-github-resource",
        resource: "environments",
        name: "release",
        definition: { protected_branches: true },
        expectedStateDigest: undefined,
      },
      {
        kind: "delete-github-resource",
        resource: "rulesets",
        name: "legacy",
        expectedStateDigest: "old",
      },
      {
        kind: "github-ruleset-transition",
        steps: [
          {
            change: { kind: "delete", name: "old-rule" },
            before: [],
            after: [],
          },
          {
            change: {
              kind: "upsert",
              name: "hj-main",
              definition: {
                target: "branch",
                enforcement: "active",
                conditions: {
                  ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] },
                },
              },
            },
            before: [],
            after: [],
          },
        ],
      },
      {
        kind: "app-setup",
        name: "release-bot",
        repository: "owner/repo",
        environment: "release",
        secretName: "APP_KEY",
        nonSecretConfiguration: {},
      },
    ];
    const output = (await Promise.all(changes.map((change) =>
      describePlannedChange(change, files)
    ))).join("\n");
    for (
      const expected of [
        "generated/new.ts",
        "755",
        "legacy.ts",
        "its current contents",
        "legacy-dir",
        "README.md",
        "readme/README.md",
        "old-link",
        "cli.ts",
        "lock = true",
        "add value",
        "legacy",
        "default branch main",
        "an empty change",
        "origin",
        "allow_auto_merge = true",
        "environments/release",
        "rulesets/legacy",
        "old-rule",
        "hj-main",
        'target = "branch"',
        'enforcement = "active"',
        "~DEFAULT_BRANCH",
        "APP_KEY",
      ]
    ) {
      assertStringIncludes(output, expected);
    }
    assert(!output.includes("private"));
    assert(!output.includes("secret@"));
    assertEquals(await files.exists("generated"), false);
    const rules = await describePlannedChange(
      {
        kind: "upsert-github-resource",
        resource: "repository-ruleset",
        name: "hj-main",
        definition: {
          name: "hj-main",
          target: "branch",
          enforcement: "active",
        },
        expectedStateDigest: "old",
      },
      files,
      {
        repository: () =>
          Promise.resolve(undefined),
        rulesets: () => Promise.resolve([]),
        environments: () => Promise.resolve([]),
        variables: () => Promise.resolve([]),
        secretExists: () => Promise.resolve(undefined),
        resource: (kind, name) =>
          Promise.resolve({
            kind,
            name,
            stateDigest: "old",
            definition: {
              name: "hj-main",
              target: "branch",
              enforcement: "disabled",
            },
          }),
      },
    );
    assertStringIncludes(rules, 'enforcement = "active"');
    assert(!rules.includes("target ="));
  } finally {
    await remove(path, { recursive: true });
  }
});
