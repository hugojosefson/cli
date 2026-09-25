import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import { assert, assertEquals, assertRejects } from "@std/assert";
import { parse } from "jsonc-parser";
import {
  makeTempDir,
  mkdir,
  readTextFile,
  remove,
  writeTextFile,
} from "../testing/files-test-fixtures.ts";
import { runRawCommand } from "../runtime/command.ts";
import { parseFeatures } from "../cli/parse-features.ts";
import { runFeatureOperation } from "../cli/run-features.ts";
import { builtInFeatureRegistry } from "./built-in-feature-registry.ts";
import { denoTaskDefinitions } from "./deno-tasks.ts";

const fixture = `{
  // Keep this configuration comment.
  "exclude": ["vendor"],
  "fmt": {
    "lineWidth": 88,
    "exclude": [
      // Keep this exclusion comment.
      "generated"
    ]
  },
  "tasks": {
    "fmt": "deno fmt --ignore=coverage",
    "format": {"description": "Custom check", "command": "deno fmt --check --ignore=coverage", "dependencies": ["prepare"]},
    "prepare": "deno fmt --check",
    "check": {"dependencies": ["custom"]},
    "custom": "deno eval 'void 0'"
  }
}\n`;

test("format repair keeps custom configuration and tasks and protects excluded files in real Deno", async () => {
  await repository(async (root) => {
    await writeTextFile(new URL("deno.jsonc", root), fixture);
    for (const directory of ["generated", "coverage", "vendor"]) {
      await mkdir(new URL(`${directory}/`, root));
      await writeTextFile(new URL(`${directory}/bad.ts`, root), "const x=1");
    }
    const before = await run(root);
    assert(before.includes("deno-fmt"));
    assert(before.includes("tasks.fmt uses --ignore=coverage"), before);
    assertEquals(before.match(/tasks\.fmt = "deno fmt"/g)?.length, 1);
    assertEquals(
      before.match(/tasks\.format\.command = "deno fmt --check"/g)?.length,
      1,
    );
    assertEquals(before.match(/fmt\.exclude\.1 = "coverage"/g)?.length, 1);
    assertEquals(await readTextFile(new URL("deno.jsonc", root)), fixture);
    await run(root, "--deno-fmt", "--repair");
    const text = await readTextFile(new URL("deno.jsonc", root));
    const config = parse(text);
    assert(text.includes("// Keep this configuration comment."));
    assert(text.includes("// Keep this exclusion comment."));
    assertEquals(config.exclude, ["vendor"]);
    assertEquals(config.fmt, {
      lineWidth: 88,
      exclude: ["generated", "coverage"],
    });
    const expectedTasks = parse(fixture).tasks;
    expectedTasks.fmt = "deno fmt";
    expectedTasks.format.command = "deno fmt --check";
    assertEquals(config.tasks, expectedTasks);
    await command(root, ["task", "fmt"]);
    await command(root, ["task", "format"]);
    for (const directory of ["generated", "coverage", "vendor"]) {
      assertEquals(
        await readTextFile(new URL(`${directory}/bad.ts`, root)),
        "const x=1",
      );
    }
    const formatted = await readTextFile(new URL("deno.jsonc", root));
    await run(root, "--deno-fmt", "--repair");
    assertEquals(await readTextFile(new URL("deno.jsonc", root)), formatted);
  });
});

test("format lifecycle keeps shared exclusions after tasks are removed", async () => {
  for (const exclude of [["generated"], ["generated", "coverage"]]) {
    await repository(async (root) => {
      await writeTextFile(
        new URL("deno.jsonc", root),
        JSON.stringify({
          fmt: { exclude },
          tasks: { custom: "deno eval 'void 0'" },
        }),
      );
      await run(root, "--deno-fmt");
      const enabled = parse(await readTextFile(new URL("deno.jsonc", root)));
      assertEquals(enabled.fmt.exclude, ["generated", "coverage"]);
      assertEquals(enabled.tasks.fmt.command, "deno fmt");
      await run(root, "--no-deno-fmt");
      const disabled = parse(await readTextFile(new URL("deno.jsonc", root)));
      assertEquals(disabled.fmt.exclude, ["generated", "coverage"]);
      assertEquals(disabled.tasks, { custom: "deno eval 'void 0'" });
    });
  }
});

test("format repair adds a missing managed exclusion once", async () => {
  await repository(async (root) => {
    await writeTextFile(
      new URL("deno.jsonc", root),
      JSON.stringify({ tasks: denoTaskDefinitions() }),
    );
    const before = await run(root);
    assertEquals(before.match(/fmt\.exclude = \["coverage"\]/g)?.length, 1);
    await run(root, "--deno-fmt", "--repair");
    const text = await readTextFile(new URL("deno.jsonc", root));
    await run(root, "--deno-fmt");
    assertEquals(await readTextFile(new URL("deno.jsonc", root)), text);
    assertEquals(parse(text).fmt.exclude, ["coverage"]);
  });
});

test("format inspection keeps custom ignore commands for manual repair", async () => {
  for (
    const command of [
      "deno fmt --ignore=vendor",
      "deno fmt --ignore=coverage && echo custom",
    ]
  ) {
    await repository(async (root) => {
      const text = JSON.stringify({
        tasks: { fmt: command, format: "deno fmt --check" },
      });
      await writeTextFile(new URL("deno.jsonc", root), text);
      const before = await run(root);
      assert(
        before.includes("tasks.fmt --ignore paths to fmt.exclude manually"),
        before,
      );
      await assertRejects(() => run(root, "--deno-fmt", "--repair"));
      assertEquals(await readTextFile(new URL("deno.jsonc", root)), text);
    });
  }
});

test("format repair adds a missing companion and rejects a conflicting command", async () => {
  await repository(async (root) => {
    await writeTextFile(
      new URL("deno.jsonc", root),
      JSON.stringify({ tasks: { fmt: "deno fmt --ignore=coverage" } }),
    );
    const before = await run(root);
    assert(before.includes("tasks.format is missing"), before);
    assertEquals(
      before.match(/tasks\.format\.command = "deno fmt --check"/g)?.length,
      1,
    );
    await run(root, "--deno-fmt", "--repair");
    const config = parse(await readTextFile(new URL("deno.jsonc", root)));
    assertEquals(config.tasks.fmt, "deno fmt");
    assertEquals(config.tasks.format, denoTaskDefinitions().format);
  });
  await repository(async (root) => {
    const text = JSON.stringify({
      tasks: {
        fmt: "deno fmt --ignore=coverage",
        format: "prettier --check .",
      },
    });
    await writeTextFile(new URL("deno.jsonc", root), text);
    assert((await run(root)).includes("correct tasks.format manually"));
    await assertRejects(() => run(root, "--deno-fmt", "--repair"));
    assertEquals(await readTextFile(new URL("deno.jsonc", root)), text);
  });
});

test("format exclusions accept existing equivalent paths without task changes", async () => {
  for (
    const exclusions of [{ exclude: ["coverage"] }, {
      fmt: { exclude: ["./coverage"] },
    }, { fmt: { exclude: ["coverage/"] } }]
  ) {
    await repository(async (root) => {
      const text = JSON.stringify({
        ...exclusions,
        tasks: {
          ...denoTaskDefinitions(),
          check: "deno eval 'void 0'",
          default: "deno eval 'void 0'",
        },
      });
      await writeTextFile(new URL("deno.jsonc", root), text);
      await run(root, "--deno-fmt", "--repair");
      assertEquals(await readTextFile(new URL("deno.jsonc", root)), text);
    });
  }
});

test("format configuration repair leaves custom aggregate tasks unchanged", async () => {
  await repository(async (root) => {
    const tasks = {
      ...denoTaskDefinitions(),
      check: "deno eval 'void 0'",
      default: "deno eval 'void 0'",
    };
    await writeTextFile(new URL("deno.jsonc", root), JSON.stringify({ tasks }));
    await run(root, "--deno-fmt", "--repair");
    assertEquals(
      parse(await readTextFile(new URL("deno.jsonc", root))).tasks,
      tasks,
    );
  });
});

test("format repair rejects invalid exclusion data without writes", async () => {
  for (const fmt of [[], { exclude: "generated" }, { exclude: [7] }]) {
    await repository(async (root) => {
      const text = JSON.stringify({
        fmt,
        tasks: {
          fmt: "deno fmt --ignore=coverage",
          format: "deno fmt --check",
        },
      });
      await writeTextFile(new URL("deno.jsonc", root), text);
      const before = await run(root);
      assert(before.includes("ambiguous"), before);
      await assertRejects(() => run(root, "--deno-fmt", "--repair"));
      assertEquals(await readTextFile(new URL("deno.jsonc", root)), text);
    });
  }
});

async function repository(action: (root: URL) => Promise<void>) {
  const path = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-format-exclusions-",
  });
  try {
    await action(new URL(`file://${path}/`));
  } finally {
    await remove(path, { recursive: true });
  }
}

function run(root: URL, ...flags: string[]) {
  return runFeatureOperation(
    root,
    parseFeatures(["repo", "features", ...flags], builtInFeatureRegistry),
    builtInFeatureRegistry,
    undefined,
    {
      runFinalTask: () => Promise.resolve(undefined),
    },
  );
}

async function command(root: URL, args: string[]) {
  const result = await runRawCommand("deno", { args, cwd: root.pathname });
  assert(result.success, new TextDecoder().decode(result.stderr));
}
