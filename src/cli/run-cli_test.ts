import { assertEquals, assertRejects } from "@std/assert";
import { formatCliOutput } from "./format-output.ts";
import { runCli } from "./run-cli.ts";

Deno.test("dispatches README builds and rejects extra arguments", async () => {
  const path = await Deno.makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-cli-",
  });
  const root = new URL(`file://${path}/`);
  try {
    await Deno.mkdir(new URL("readme", root));
    await Deno.writeTextFile(new URL("readme/README.md", root), "# default\n");
    await Deno.writeTextFile(new URL("other.md", root), "# other");
    assertEquals(
      formatCliOutput(await runCli(root, ["readme", "build"])),
      "# default\n",
    );
    assertEquals(
      formatCliOutput(await runCli(root, ["readme", "build", "other.md"])),
      "# other",
    );
    await assertRejects(
      () => runCli(root, ["readme", "build", "other.md", "extra"]),
      Error,
      "expected `hj readme build [input]`",
    );
  } finally {
    await Deno.remove(path, { recursive: true });
  }
});

Deno.test("keeps repo features dispatch", async () => {
  const path = await Deno.makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-cli-",
  });
  const root = new URL(`file://${path}/`);
  try {
    assertEquals(
      formatCliOutput(await runCli(root, ["repo", "features"])),
      "deno-cli: disabled\ndeno-fmt: disabled\ndeno-lib: disabled\ndeno-lint: disabled\ndeno-server: disabled\ndeno-test: disabled\ndeno-typecheck: disabled\ngit: disabled\nlicense-mit: disabled\nreadme-build: disabled\nreadme-static: disabled\n",
    );
  } finally {
    await Deno.remove(path, { recursive: true });
  }
});
