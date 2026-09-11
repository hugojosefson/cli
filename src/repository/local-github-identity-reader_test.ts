import { assertEquals } from "@std/assert";
import { LocalGithubIdentityReader } from "./local-github-identity-reader.ts";

Deno.test("GitHub identity ignores missing or malformed display names", async () => {
  for (
    const [value, expected] of [
      [{ name: "  Ada Lovelace  " }, { name: "Ada Lovelace" }],
      [{ name: null }, undefined],
      [{ name: " " }, undefined],
      [{ name: 123 }, undefined],
      [null, undefined],
    ] as const
  ) {
    const reader = new LocalGithubIdentityReader(
      new URL("file:///tmp/opencode/"),
      {
        run: (args) => {
          assertEquals(args, ["api", "user"]);
          return Promise.resolve({
            success: true,
            stdout: new TextEncoder().encode(JSON.stringify(value)),
          });
        },
      },
    );
    assertEquals(await reader.viewer(), expected);
  }
});

Deno.test("GitHub identity allows attribution fallback after command failures", async () => {
  const reader = new LocalGithubIdentityReader(
    new URL("file:///tmp/opencode/"),
    {
      run: () => Promise.reject(new Error("not installed")),
    },
  );
  assertEquals(await reader.viewer(), undefined);
});
