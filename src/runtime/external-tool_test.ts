import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import { assertEquals, assertRejects } from "@std/assert";
import { ExternalToolError, requireExternalTool } from "./external-tool.ts";
import { githubCommandFailure } from "../repository/github-command.ts";

test("external tool checks classify native and Deno absence without parsing stderr", async () => {
  for (
    const cause of [
      Object.assign(new Error(), { code: "ENOENT" }),
      Object.assign(new Error("missing"), { name: "NotFound" }),
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
  const denied = Object.assign(new Error("permission denied"), {
    name: "NotCapable",
  });
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
