import { test as nativeTest } from "node:test";
import { trackTests } from "../../src/testing/inventory-test-fixtures.ts";
import { assertEquals, assertThrows } from "@std/assert";
import { packResult } from "./pack-result.ts";
const test = trackTests(import.meta.url, nativeTest);

test("npm archive metadata accepts array and keyed output", () => {
  const metadata = {
    name: "@owner/cli",
    version: "1.0.0",
    filename: "owner-cli-1.0.0.tgz",
    integrity: "sha512-example",
  };
  for (const value of [[metadata], { [metadata.name]: metadata }]) {
    assertEquals(packResult(JSON.stringify(value), metadata), metadata);
  }
  for (
    const value of [
      [],
      [metadata, metadata],
      [{ ...metadata, filename: "../archive.tgz" }],
      [{ ...metadata, version: "2.0.0" }],
      null,
    ]
  ) {
    assertThrows(
      () => packResult(JSON.stringify(value), metadata),
      Error,
      "invalid archive metadata",
    );
  }
});
