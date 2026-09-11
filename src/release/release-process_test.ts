import { assertEquals, assertRejects } from "@std/assert";
import { runOrThrow } from "./release-process.ts";

Deno.test("release failures identify the operation and exit code without exposing process data", async () => {
  const process = {
    run: () =>
      Promise.resolve({
        success: false,
        code: 128,
        stdout: new TextEncoder().encode("private-output"),
        stderr: new TextEncoder().encode("private-error"),
      }),
  };
  const error = await assertRejects(
    () =>
      runOrThrow(process, "git", [
        "-c",
        "private-config",
        "commit",
        "-m",
        "private-argument",
      ]),
    Error,
  );
  assertEquals(error.message, "Release command failed: git commit (exit 128).");
});
