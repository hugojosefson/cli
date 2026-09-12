import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import {
  chmod,
  makeTempDir,
  mkdir,
  remove,
  writeTextFile,
} from "../testing/files-test-fixtures.ts";
import { runRawCommand as runCommand } from "../runtime/command.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import type { OperationContext } from "../api/repository-context.ts";
import { applyLocalChangePlan } from "../operations/local-change-plan.ts";
import { LocalFileReader } from "../repository/local-file-reader.ts";
import { editorconfigFeature as feature } from "./editorconfig-feature.ts";
import {
  editorconfigStarter,
  readEditorconfigOwnership,
  updateEditorconfig,
} from "./editorconfig-content.ts";

test("EditorConfig independent lifecycle creates exact starter and removes owned files", async () => {
  await repository(async (context) => {
    assertEquals(feature.dependencies.requires, []);
    assertEquals((await feature.detect(context)).state, "disabled");
    await apply(context, true);
    assertEquals(
      await context.files.readText(".editorconfig"),
      editorconfigStarter,
    );
    assertEquals((await feature.detect(context)).state, "enabled");
    assertEquals((await feature.checkEnable(context)).result, "no-op");
    await apply(context, false);
    assertEquals(await context.files.readText(".editorconfig"), undefined);
    assertEquals(
      await context.files.readText(".hj/editorconfig.json"),
      undefined,
    );
    assertEquals((await feature.detect(context)).state, "disabled");
    assertEquals((await feature.checkDisable(context)).result, "no-op");
  });
});

test("EditorConfig preserves custom section precedence, case, values, CRLF and file mode", async () => {
  await repository(async (context) => {
    const custom =
      "# user\r\nROOT = false\r\n[*.md]\r\ntrim_trailing_whitespace = false\r\n[*]\r\nINDENT_SIZE = 4\r\nindent_style = tab\r\n[Makefile]\r\nindent_style = tab";
    await write(context, custom);
    await chmod(new URL(".editorconfig", context.repositoryRoot), 0o600);
    await apply(context, true);
    const text = (await context.files.readText(".editorconfig"))!;
    assertStringIncludes(text, custom.slice(custom.indexOf("[*.md]")));
    assert(
      text.indexOf("trim_trailing_whitespace = true") < text.indexOf("[*.md]"),
    );
    assert(!text.includes("indent_size = 2"));
    assert(!text.includes("root = true"));
    assertEquals(await context.files.mode(".editorconfig"), 0o600);
    assertEquals((await feature.detect(context)).state, "enabled");
    await apply(context, false);
    const remaining = (await context.files.readText(".editorconfig"))!;
    assertStringIncludes(remaining, custom.slice(custom.indexOf("[*.md]")));
    assert(!remaining.includes("charset = utf-8"));
  });
});

test("EditorConfig repairs missing entries and relinquishes edited entries", async () => {
  await repository(async (context) => {
    await apply(context, true);
    await write(
      context,
      editorconfigStarter.replace("indent_size = 2", "indent_size = 8").replace(
        "charset = utf-8\n",
        "",
      ) + "\n[*.md]\ntrim_trailing_whitespace = false\n",
    );
    assertEquals((await feature.detect(context)).state, "drifted");
    await apply(context, true);
    const repaired = (await context.files.readText(".editorconfig"))!;
    assertStringIncludes(repaired, "charset = utf-8");
    assertStringIncludes(repaired, "indent_size = 8");
    assertEquals((await feature.detect(context)).state, "enabled");
    assertEquals((await feature.checkEnable(context)).result, "no-op");
    await apply(context, false);
    const remaining = (await context.files.readText(".editorconfig"))!;
    assertStringIncludes(remaining, "indent_size = 8");
    assertStringIncludes(
      remaining,
      "[*.md]\ntrim_trailing_whitespace = false\n",
    );
    assert(!remaining.includes("charset = utf-8"));
  });
});

test("EditorConfig never adopts an unowned complete starter or removes duplicate entries", async () => {
  await repository(async (context) => {
    await write(context, "");
    assertEquals((await feature.checkDisable(context)).result, "no-op");
    await write(context, editorconfigStarter);
    assertEquals((await feature.detect(context)).state, "enabled");
    assertEquals((await feature.checkEnable(context)).result, "no-op");
    assertEquals((await feature.checkDisable(context)).result, "no-op");
    await remove(new URL(".editorconfig", context.repositoryRoot));
    await apply(context, true);
    await write(context, editorconfigStarter + "indent_size = 2\n");
    await apply(context, false);
    assertEquals(
      (await context.files.readText(".editorconfig"))!.match(/indent_size = 2/g)
        ?.length,
      2,
    );
  });
});

test("EditorConfig blocks invalid content, metadata, directories and symlinks", async () => {
  await repository(async (context) => {
    await write(context, "invalid line\n");
    assertEquals((await feature.detect(context)).state, "ambiguous");
    assertEquals((await feature.checkEnable(context)).result, "blocked");
    assertEquals((await feature.checkDisable(context)).result, "blocked");
    await remove(new URL(".editorconfig", context.repositoryRoot));
    await mkdir(new URL(".editorconfig", context.repositoryRoot));
    assertEquals((await feature.checkEnable(context)).result, "blocked");
    await remove(new URL(".editorconfig", context.repositoryRoot), {
      recursive: true,
    });
    await apply(context, true);
    await writeTextFile(
      new URL(".hj/editorconfig.json", context.repositoryRoot),
      '{"version":2}',
    );
    assertEquals((await feature.checkEnable(context)).result, "blocked");
    await writeTextFile(
      new URL(".hj/editorconfig.json", context.repositoryRoot),
      "not json",
    );
    assertEquals((await feature.detect(context)).state, "ambiguous");
    await remove(new URL(".editorconfig", context.repositoryRoot));
    const link = await runCommand("deno", {
      args: [
        "eval",
        "await Deno.symlink(Deno.args[0], Deno.args[1]);",
        ".hj/editorconfig.json",
        new URL(".editorconfig", context.repositoryRoot).pathname,
      ],
    });
    assert(link.success, new TextDecoder().decode(link.stderr));
    assertEquals((await feature.checkEnable(context)).result, "blocked");
  });
});

test("EditorConfig rejects stale file and ownership guards", async () => {
  await repository(async (context) => {
    let check = await feature.checkEnable(context);
    assert(check.result === "allowed");
    const plan = await feature.planEnable(context, check);
    await write(context, "# custom\n");
    await assertRejects(() =>
      applyLocalChangePlan(context.repositoryRoot, plan)
    );
    assertEquals(await context.files.readText(".editorconfig"), "# custom\n");
    await apply(context, true);
    check = await feature.checkDisable(context);
    assert(check.result === "allowed");
    const disable = await feature.planDisable(context, check);
    await writeTextFile(
      new URL(".hj/editorconfig.json", context.repositoryRoot),
      "{}",
    );
    await assertRejects(() =>
      applyLocalChangePlan(context.repositoryRoot, disable)
    );
  });
});

test("EditorConfig accepts bracket globs and comments and fills a preamble without newline", () => {
  const result = updateEditorconfig("# custom", undefined, true);
  assertStringIncludes(result.content, "# custom\nroot = true\n");
  const input =
    "root = true\n[foo[ab].txt]\ncustom = value # literal\n; comment\n";
  assertStringIncludes(
    updateEditorconfig(input, undefined, true).content,
    input.slice(input.indexOf("[foo")),
  );
  assertEquals(readEditorconfigOwnership(undefined), undefined);
});

async function apply(context: OperationContext, enabled: boolean) {
  const check = await (enabled ? feature.checkEnable : feature.checkDisable)(
    context,
  );
  assert(check.result === "allowed");
  await applyLocalChangePlan(
    context.repositoryRoot,
    await (enabled ? feature.planEnable : feature.planDisable)(context, check),
  );
}
function write(context: OperationContext, content: string) {
  return writeTextFile(
    new URL(".editorconfig", context.repositoryRoot),
    content,
  );
}
async function repository(
  action: (context: OperationContext) => Promise<void>,
) {
  const path = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-editorconfig-",
  });
  const root = new URL(`file://${path}/`);
  const unused = () => {
    throw new Error("EditorConfig must not access Git");
  };
  try {
    await action({
      repositoryRoot: root,
      files: new LocalFileReader(root),
      git: {
        isRepository: unused,
        head: unused,
        status: unused,
        remotes: unused,
        defaultBranch: unused,
      },
      detections: new Map(),
      requestedChanges: [],
      resolvedChanges: [],
      repair: undefined,
      options: {},
    });
  } finally {
    await remove(root, { recursive: true });
  }
}
