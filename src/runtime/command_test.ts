import { assertEquals, assertRejects } from "@std/assert";
import { runCommand } from "./command.ts";
import { isNotFound } from "./errors.ts";

Deno.test("native commands preserve input, separate output, cwd and exit status", async () => {
  const result = await runCommand("sh", {
    args: ["-c", 'cat; printf "%s" "$HJ_COMMAND_TEST" >&2; exit 7'],
    cwd: new URL("file:///tmp/opencode/"),
    env: { HJ_COMMAND_TEST: "diagnostic" },
    input: "hello\u0000world",
  });
  assertEquals(result.success, false);
  assertEquals(result.code, 7);
  assertEquals(new TextDecoder().decode(result.stdout), "hello\u0000world");
  assertEquals(new TextDecoder().decode(result.stderr), "diagnostic");
  const pwd = await runCommand("sh", {
    args: ["-c", "pwd"],
    cwd: new URL("file:///tmp/opencode/"),
  });
  assertEquals(new TextDecoder().decode(pwd.stdout).trim(), "/tmp/opencode");
});

Deno.test("native commands close stdin and preserve terminating signals", async () => {
  const result = await runCommand("sh", { args: ["-c", "cat; kill -TERM $$"] });
  assertEquals(result.success, false);
  assertEquals(result.code, 143);
  assertEquals(result.stdout.length, 0);
});

Deno.test("filesystem errors distinguish absence from denied access", async () => {
  const error = await assertRejects(() =>
    runCommand("git", {
      args: ["--version"],
      cwd: "/tmp/opencode/hj-command-missing-directory",
    })
  );
  assertEquals(isNotFound(error), true);
  assertEquals(isNotFound(new Error("not missing")), false);
  assertEquals(
    isNotFound(Object.assign(new Error(), { code: "EACCES" })),
    false,
  );
});

Deno.test("native commands drain large output while writing large input", async () => {
  const result = await runCommand("sh", {
    args: ["-c", "head -c 1048576 /dev/zero; cat"],
    input: new Uint8Array(1048576).fill(7),
  });
  assertEquals(result.success, true);
  assertEquals(result.stdout.length, 2097152);
  assertEquals(result.stdout.at(-1), 7);
});
