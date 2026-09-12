import { assertEquals, assertRejects } from "@std/assert";
import { ExternalToolError, requireExternalTool } from "./external-tool.ts";
import { githubCommandFailure } from "../repository/github-command.ts";

Deno.test("external tool checks classify native and Deno absence without parsing stderr", async () => {
  for (
    const cause of [
      Object.assign(new Error(), { code: "ENOENT" }),
      new Deno.errors.NotFound(),
    ]
  ) {
    for (const tool of ["git", "gh"] as const) {
      const error = await assertRejects(
        () =>
          requireExternalTool(tool, () => {
            throw cause;
          }),
        ExternalToolError,
        "Install it from https://",
      );
      assertEquals(
        githubCommandFailure(["api"], undefined, error),
        error.message,
      );
    }
  }
  const denied = new Deno.errors.NotCapable("permission denied");
  assertEquals(
    await assertRejects(() =>
      requireExternalTool("gh", () => {
        throw denied;
      })
    ),
    denied,
  );
  const broken = await assertRejects(
    () =>
      requireExternalTool("gh", () =>
        Promise.resolve({
          success: false,
          code: 7,
          stdout: new Uint8Array(),
          stderr: new TextEncoder().encode("secret stderr"),
        })),
    ExternalToolError,
    "exit 7",
  );
  assertEquals(broken.message.includes("secret stderr"), false);
});
