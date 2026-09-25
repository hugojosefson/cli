import { test as nativeTest } from "node:test";
import { constants } from "node:fs";
import { assert, assertEquals } from "@std/assert";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
import {
  fixtureReadDir,
  fixtureStat,
  makeTempDir,
  mkdir,
  readTextFile,
  remove,
  writeTextFile,
} from "../testing/files-test-fixtures.ts";
import { runRawCommand } from "../runtime/command.ts";
import { readmeTaskDefinition } from "./deno-tasks.ts";

const test = trackTests(import.meta.url, nativeTest);

test("README task replaces read-only output with terminal input across umasks", async () => {
  const path = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-readme-tty-",
  });
  const root = new URL(`file://${path}/`);
  try {
    await mkdir(new URL("bin", root));
    await writeTextFile(
      new URL("bin/deno", root),
      "#!/bin/sh\nprintf '# Built\\n'\n",
    );
    await writeTextFile(
      new URL("readme.sh", root),
      `test -t 0 || exit 19\n${readmeTaskDefinition.command}\n`,
    );
    const setup = await runRawCommand("sh", {
      args: ["-c", "chmod u+x bin/deno"],
      cwd: root,
    });
    assert(setup.success);
    for (const mask of ["a=rwx", "u=rwx,go=rx", "u=rwx,go="]) {
      for (const expected of ["# Built\n", "# Rebuilt\n"]) {
        await writeTextFile(
          new URL("bin/deno", root),
          `#!/bin/sh\nprintf '${expected}'\n`,
        );
        const result = await runRawCommand("sh", {
          args: [
            "-c",
            'umask "$1" && exec script --quiet --return --echo never --command "sh ./readme.sh" /dev/null',
            "--",
            mask,
          ],
          cwd: root,
          env: { PATH: `${new URL("bin", root).pathname}:/usr/bin:/bin` },
          input: "n\n",
          signal: AbortSignal.timeout(10000),
        });
        assertEquals(result.code, 0, new TextDecoder().decode(result.stdout));
        assertEquals(new TextDecoder().decode(result.stdout), "");
        assertEquals(new TextDecoder().decode(result.stderr), "");
        assertEquals(await readTextFile(new URL("README.md", root)), expected);
        const mode = (await fixtureStat(new URL("README.md", root))).mode!;
        assertEquals(
          mode & (constants.S_IWUSR | constants.S_IWGRP | constants.S_IWOTH),
          0,
        );
      }
    }
    const names = [];
    for await (const entry of fixtureReadDir(root)) names.push(entry.name);
    assertEquals(names.filter((name) => name.startsWith("README.md.")), []);
  } finally {
    await remove(path, { recursive: true });
  }
});
