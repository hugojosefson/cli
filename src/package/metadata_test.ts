import { assertEquals, assertRejects } from "@std/assert";
import { projectMetadata, validJsrName } from "./metadata.ts";
import { withRepository } from "../features/jsr-package-feature-support.ts";

Deno.test("package metadata enforces public JSR length and character constraints", () => {
  for (
    const name of [
      "@ab/cd",
      `@${"a".repeat(20)}/${"b".repeat(58)}`,
      "@org/deno-unchanged",
    ]
  ) assertEquals(validJsrName(name), true, name);
  for (
    const name of [
      "@a/cd",
      "@ab/c",
      `@${"a".repeat(21)}/cd`,
      `@ab/${"b".repeat(59)}`,
      "@ab/c--d",
      "@ab/cd-",
      "@-ab/cd",
      "@Ab/cd",
      "@ab/c_d",
      "@ab/cd/ef",
    ]
  ) assertEquals(validJsrName(name), false, name);
});

Deno.test("package metadata reads JSONC and validates a single command override", async () => {
  await withRepository(async (root) => {
    const path = new URL("deno.jsonc", root);
    await Deno.writeTextFile(
      path,
      '// retained\n{"name":"@scope/deno-fancy", "hj":{"commandName":"custom-command"},}',
    );
    const value = await projectMetadata(root);
    assertEquals(value.name, "@scope/deno-fancy");
    assertEquals(value.command, "custom-command");
    await Deno.writeTextFile(
      path,
      '{"name":"@scope/tool", "hj":{"commandName":"bad command"}}',
    );
    await assertRejects(() => projectMetadata(root), Error, "commandName");
    await Deno.writeTextFile(path, '{"name":"@scope/tool"}');
    await Deno.writeTextFile(new URL("deno.json", root), "{}");
    await assertRejects(() => projectMetadata(root), Error, "Both deno.json");
    await Deno.remove(new URL("deno.json", root));
    await Deno.writeTextFile(path, '{"name":');
    await assertRejects(() => projectMetadata(root), Error, "valid JSON");
  });
});
