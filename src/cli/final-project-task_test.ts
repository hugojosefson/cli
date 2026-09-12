import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import {
  makeTempDir,
  readTextFile,
  remove,
  writeTextFile,
} from "../testing/files-test-fixtures.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import type { ChangePlan } from "../api/change-plan.ts";
import { CommandFailure } from "./command-failure.ts";
import { runFinalProjectTask } from "./final-project-task.ts";

function plan(changes: ChangePlan["changes"]): ChangePlan {
  return {
    featureId: "example",
    action: "enable",
    summary: "Update task inputs",
    warnings: [],
    preconditions: [],
    validations: [],
    changes,
  };
}

const changed = plan([{
  kind: "write-file",
  path: "input.ts",
  content: "export {};\n",
  expectedDigest: undefined,
}]);

test("final task runs exactly once using the resulting JSONC definition and directory", async () => {
  await fixture(async (root) => {
    await writeTextFile(
      new URL("deno.jsonc", root),
      String.raw`{
      // The replaced task must never run.
      "tasks": { "default": "deno eval 'throw new Error(\"old task\")'" }
    }`,
    );
    await writeTextFile(
      new URL("deno.jsonc", root),
      String.raw`{
      // Final task dependencies run from the project root.
      "tasks": {
        "prepare": "deno eval 'Deno.writeTextFileSync(\"marker\", \"once\", {append:true})'",
        "default": {"dependencies": ["prepare"], "command": "deno eval 'if(Deno.readTextFileSync(\"marker\") !== \"once\") Deno.exit(8)'"},
      },
    }`,
    );
    assertEquals(
      await runFinalProjectTask(root, [changed, changed]),
      "deno task default passed.",
    );
    assertEquals(await readTextFile(new URL("marker", root)), "once");
  });
});

test("read-only, empty and remote-only plans do not execute tasks", async () => {
  await fixture(async (root) => {
    await config(root, "deno eval 'Deno.exit(23)'");
    for (
      const plans of [[], [plan([])], [plan([{ kind: "git-init" }])], [
        plan([{
          kind: "upsert-github-resource",
          resource: "repository",
          name: "example",
          definition: {},
          expectedStateDigest: undefined,
        }]),
      ]]
    ) {
      assertEquals(await runFinalProjectTask(root, plans), undefined);
    }
  });
});

test("removal and file-mode changes run the final task conservatively", async () => {
  await fixture(async (root) => {
    await config(
      root,
      'deno eval \'Deno.writeTextFileSync("marker", "once", {append:true})\'',
    );
    await runFinalProjectTask(root, [plan([{
      kind: "remove-file",
      path: "input.ts",
      expectedDigest: "old",
    }])]);
    await runFinalProjectTask(root, [plan([{
      kind: "set-file-mode",
      path: "script.ts",
      mode: 0o755,
      expectedMode: 0o644,
    }])]);
    assertEquals(await readTextFile(new URL("marker", root)), "onceonce");
  });
});

test("removed default and missing final configuration are reported without execution", async () => {
  await fixture(async (root) => {
    for (
      const contents of [undefined, {}, { tasks: { check: "deno check" } }]
    ) {
      if (contents) {
        await writeTextFile(
          new URL("deno.json", root),
          JSON.stringify(contents),
        );
      }
      assertEquals(
        await runFinalProjectTask(root, [changed]),
        "No final default task remains.",
      );
    }
  });
});

test("failed final task preserves its exit code and task edits", async () => {
  await fixture(async (root) => {
    await config(
      root,
      'deno eval \'Deno.writeTextFileSync("fix-me", "visible"); Deno.exit(17)\'',
    );
    const error = await assertRejects(
      () => runFinalProjectTask(root, [changed]),
      CommandFailure,
      "deno task default failed (exit 17)",
    );
    assertEquals(error.exitCode, 17);
    assertStringIncludes(
      error.message,
      "no feature-content commits were created",
    );
    assertEquals(await readTextFile(new URL("fix-me", root)), "visible");
  });
});

test("ambiguous final configuration stops before task execution", async () => {
  await fixture(async (root) => {
    await config(root, "deno eval 'Deno.exit(23)'");
    await writeTextFile(new URL("deno.jsonc", root), "{}");
    await assertRejects(
      () => runFinalProjectTask(root, [changed]),
      Error,
      "Both deno.json and deno.jsonc exist",
    );
  });
});

async function config(root: URL, command: string) {
  await writeTextFile(
    new URL("deno.json", root),
    JSON.stringify({ tasks: { default: command } }),
  );
}

async function fixture(action: (root: URL) => Promise<void>) {
  const path = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-final-task-",
  });
  const root = new URL(`file://${path}/`);
  try {
    await action(root);
  } finally {
    await remove(root, { recursive: true });
  }
}
