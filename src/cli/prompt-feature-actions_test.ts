import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import {
  executableModule,
  runModuleEval,
} from "../testing/runtime-test-fixtures.ts";
import { assertEquals, assertStringIncludes } from "@std/assert";

test("interactive selection fails clearly when stdin is not a terminal", async () => {
  const module =
    executableModule("./prompt-feature-actions.ts", import.meta.url).href;
  const result = await runModuleEval(
    `import { promptFeatureActions } from ${
      JSON.stringify(module)
    }; await promptFeatureActions([{ label: "Enable Git", value: "git" }]);`,
    [],
    {
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    },
  );
  assertEquals(result.success, false);
  assertStringIncludes(
    new TextDecoder().decode(result.stderr),
    "interactive mode requires a TTY",
  );
});
