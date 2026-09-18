import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import { assertEquals } from "@std/assert";
import { npmPublicationDiagnostic } from "./npm-publication-diagnostic.ts";

test("npm diagnostics discard unknown, invalid and successful process output", () => {
  for (
    const text of [
      "dummy-private-output",
      "null",
      "{}",
      '{"error":{"code":"E403\\ndummy-private-value"}}',
      '{"error":{"code":"dummy-private-value"}}',
      '{"error":{"code":403}}',
    ]
  ) {
    assertEquals(
      npmPublicationDiagnostic({
        success: false,
        code: 1,
        stdout: new TextEncoder().encode(text),
        stderr: new TextEncoder().encode("dummy-private-stderr"),
      }),
      "npm publish exit code: 1.",
    );
  }
  assertEquals(
    npmPublicationDiagnostic({
      success: true,
      code: 0,
      stdout: new TextEncoder().encode('{"error":{"code":"E403"}}'),
      stderr: new Uint8Array(),
    }),
    "npm publish exit code: 0.",
  );
  assertEquals(
    npmPublicationDiagnostic({
      success: false,
      code: NaN,
      stdout: new Uint8Array(),
      stderr: new Uint8Array(),
    }),
    "npm publish exit code is unavailable.",
  );
});
