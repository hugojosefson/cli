import { assertEquals, assertStringIncludes } from "@std/assert";

Deno.test("interactive selection fails clearly when stdin is not a terminal", async () => {
  const module = new URL("./prompt-feature-actions.ts", import.meta.url).href;
  const result = await new Deno.Command("deno", {
    args: [
      "eval",
      `import { promptFeatureActions } from ${
        JSON.stringify(module)
      }; await promptFeatureActions([{ label: "Enable Git", value: "git" }]);`,
    ],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(result.success, false);
  assertStringIncludes(
    new TextDecoder().decode(result.stderr),
    "interactive mode requires a TTY",
  );
});
