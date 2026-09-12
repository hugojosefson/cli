import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import { assertEquals } from "@std/assert";
import { formatTable } from "./format-table.ts";

test("tables align cells without terminal codes or trailing spaces", () => {
  assertEquals(
    formatTable(["Feature", "State"], [["git", "enabled"], [
      "readme",
      "disabled",
    ]]),
    "Feature  State\n-------  --------\ngit      enabled\nreadme   disabled",
  );
});

test("tables wrap long and multiline cells without losing content", () => {
  assertEquals(
    formatTable(["ID", "Note"], [["a", "one two three\nfour"], [
      "b",
      "abcdefghij",
    ]], [2, 5]),
    "ID  Note\n--  -----\na   one\n    two\n    three\n    four\nb   abcde\n    fghij",
  );
});

test("tables handle empty data, missing cells, and control characters", () => {
  assertEquals(formatTable(["ID"], []), "ID\n--");
  assertEquals(
    formatTable(["ID", "Note"], [["a"], [
      "b",
      "\x1b[31mred\x1b[0m\tvalue\x00",
    ]]),
    "ID  Note\n--  ---------\na\nb   red value",
  );
});
