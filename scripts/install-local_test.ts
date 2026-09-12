import { assertEquals, assertStringIncludes } from "@std/assert";

Deno.test("installed hj keeps the caller directory and works outside the checkout", async () => {
  const root = await Deno.makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj install ",
  });
  try {
    const install = await new Deno.Command("deno", {
      args: [
        "run",
        "--allow-env",
        "--allow-run=deno",
        "--allow-read",
        new URL("./install-local.ts", import.meta.url).href,
        "--root",
        `${root}/tools`,
      ],
      cwd: root,
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(
      install.success,
      true,
      new TextDecoder().decode(install.stderr),
    );
    const run = async (args: string[]) => {
      const result = await new Deno.Command("sh", {
        args: [`${root}/tools/bin/hj`, ...args],
        cwd: root,
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(
        result.success,
        true,
        new TextDecoder().decode(result.stderr),
      );
      return new TextDecoder().decode(result.stdout);
    };
    assertStringIncludes(await run(["--help"]), "hj repo features");
    await run(["repo", "features", "--deno-fmt", "--yes"]);
    const config = JSON.parse(await Deno.readTextFile(`${root}/deno.jsonc`));
    assertEquals(config.tasks.fmt.command, "deno fmt --ignore=coverage");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
