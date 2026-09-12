import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import {
  makeTempDir,
  readTextFile,
  remove,
  writeTextFile,
} from "../testing/files-test-fixtures.ts";
import { runCli } from "../cli/run-cli.ts";
import {
  parseChangelogMigration,
  runChangelogMigration,
} from "../cli/run-changelog.ts";
import {
  localReleaseProcess,
  type ReleaseProcess,
  runOrThrow,
} from "./release-process.ts";
import { migrateChangelog } from "./migrate-changelog.ts";

const preamble =
  "# Project history\n\nCustom   spacing and [link](https://example.com).\n\n~~~md\n## 99.0.0\n- feat: example\n~~~\n\n";
const tail = "## Initial capabilities\n\nCustom  table stays intact.\n";
const legacy = `${preamble}## 0.1.0\n\n- feat(cli): add command\n\n${tail}`;

test("migration previews and applies verified sections, preserves narrative, and is idempotent", async () => {
  await withHistory(async (root, process) => {
    const preview = await runCli(root, ["changelog", "migrate"], {
      releaseProcess: process,
    });
    assertEquals(await readTextFile(new URL("CHANGELOG.md", root)), legacy);
    assertStringIncludes(preview.output, "### Features\n\n#### cli");
    assertEquals(preview.output.startsWith(preamble), true);
    assertEquals(preview.output.endsWith(tail), true);
    const write = await runCli(root, ["changelog", "migrate", "--write"], {
      releaseProcess: process,
    });
    assertStringIncludes(write.output, "Migrated CHANGELOG.md");
    assertEquals(
      await readTextFile(new URL("CHANGELOG.md", root)),
      preview.output,
    );
    assertEquals(
      await migrateChangelog(preview.output, "owner/repo", process),
      preview.output,
    );
    assertStringIncludes(
      await runChangelogMigration(root, { write: true }, process),
      "already uses grouped",
    );
    assertEquals(
      (await runOrThrow(process, "git", ["status", "--porcelain"])).trim(),
      "M CHANGELOG.md",
    );
  });
});

test("migration fails closed for custom release edits, duplicates, missing and annotated tags", async () => {
  await withHistory(async (_root, process) => {
    await assertRejects(
      () =>
        migrateChangelog(
          legacy.replace("add command", "manually rewritten"),
          "owner/repo",
          process,
        ),
      Error,
      "custom or mismatched",
    );
    await assertRejects(
      () =>
        migrateChangelog(
          legacy + "\n## 0.1.0\n\n- duplicate\n",
          "owner/repo",
          process,
        ),
      Error,
      "Duplicate",
    );
    await assertRejects(
      () =>
        migrateChangelog(
          "# Custom\n\nNo release headings\n",
          "owner/repo",
          process,
        ),
      Error,
      "Keep extending",
    );
    await runOrThrow(process, "git", ["tag", "-d", "0.1.0"]);
    await assertRejects(
      () => migrateChangelog(legacy, "owner/repo", process),
      Error,
      "fetch the complete Git history",
    );
    await runOrThrow(process, "git", ["tag", "-a", "0.1.0", "-m", "annotated"]);
    await assertRejects(
      () => migrateChangelog(legacy, "owner/repo", process),
      Error,
      "lightweight ancestor tag",
    );
  });
});

test("migration validates flags and supports explicit identity with local remotes", async () => {
  for (
    const args of [["--yes"], ["--write", "--write"], [
      "--repository=owner/repo",
      "--repository=other/repo",
    ], ["--repository=../repo"]]
  ) {
    assertThrows(() => parseChangelogMigration(args));
  }
  await withHistory(async (root, process) => {
    await runOrThrow(process, "git", [
      "remote",
      "set-url",
      "origin",
      "/tmp/local.git",
    ]);
    await assertRejects(
      () => runChangelogMigration(root, { write: false }, process),
      Error,
      "--repository=owner/repo",
    );
    const preview = await runChangelogMigration(root, {
      write: false,
      repository: "other/project",
    }, process);
    assertStringIncludes(preview, "https://github.com/other/project/commit/");
  });
});

test("migration refuses to overwrite content changed during its preview", async () => {
  await withHistory(async (root, process) => {
    let changed = false;
    const concurrent: ReleaseProcess = {
      run: async (command, args, options) => {
        const result = await process.run(command, args, options);
        if (!changed) {
          changed = true;
          await writeTextFile(
            new URL("CHANGELOG.md", root),
            "concurrent edit\n",
          );
        }
        return result;
      },
    };
    await assertRejects(
      () =>
        runChangelogMigration(
          root,
          { write: true, repository: "owner/repo" },
          concurrent,
        ),
      Error,
      "changed during migration",
    );
    assertEquals(
      await readTextFile(new URL("CHANGELOG.md", root)),
      "concurrent edit\n",
    );
  });
});

async function withHistory(
  action: (root: URL, process: ReleaseProcess) => Promise<void>,
): Promise<void> {
  const path = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-changelog-migrate-",
  });
  const root = new URL(`file://${path}/`);
  const process = localReleaseProcess(root);
  try {
    await runOrThrow(process, "git", ["init", "--initial-branch=main"]);
    await runOrThrow(process, "git", ["config", "user.name", "Test"]);
    await runOrThrow(process, "git", [
      "config",
      "user.email",
      "test@example.com",
    ]);
    await runOrThrow(process, "git", [
      "remote",
      "add",
      "origin",
      "git@github.com:owner/repo.git",
    ]);
    await writeTextFile(new URL("deno.json", root), '{"version":"0.0.0"}\n');
    await runOrThrow(process, "git", ["add", "deno.json"]);
    await runOrThrow(process, "git", [
      "commit",
      "-m",
      "feat(cli): add command",
    ]);
    await writeTextFile(new URL("deno.json", root), '{"version":"0.1.0"}\n');
    await writeTextFile(new URL("CHANGELOG.md", root), legacy);
    await runOrThrow(process, "git", ["add", "deno.json", "CHANGELOG.md"]);
    await runOrThrow(process, "git", ["commit", "-m", "chore(release): 0.1.0"]);
    await runOrThrow(process, "git", ["tag", "0.1.0"]);
    await action(root, process);
  } finally {
    await remove(path, { recursive: true });
  }
}
