import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
import { assertEquals } from "@std/assert";
import { validLicenseHolder } from "./license-holder.ts";
const test = trackTests(import.meta.url, nativeTest);

test("license holder accepts names without identity or path restrictions", () => {
  for (
    const name of [
      "Hugo Josefson",
      "Ada Lovelace and contributors",
      "李明",
      "Élodie O’Connor",
      "AC/DC",
      "AC\\DC",
      "Example, Inc. <dev@example.org>",
      "Example (https://example.org/team)",
      "Name",
      "Holder",
      "Organization for Research",
      "  Ada\t Lovelace  ",
    ]
  ) {
    assertEquals(validLicenseHolder(name), true, name);
  }
});

test("license holder rejects source placeholders and control characters", () => {
  for (
    const name of [
      "<copyright holders>",
      "[fullname]",
      "[name of copyright owner]",
      "<name of author>",
      "{{ organization }}",
      "{{organization}}",
      "[ YOUR NAME ]",
      "Your Name Here",
      "Copyright Holder",
      "full name",
      "[author]",
      "[owner]",
      "{name}",
      "Ada and [fullname]",
      "Ada and <copyright holders>",
      "",
      " \t ",
      ".",
      "..",
      "Ada\nLovelace",
      "Ada\rLovelace",
      "Ada\0Lovelace",
      "Ada\x1bLovelace",
      "Ada\u2028Lovelace",
    ]
  ) {
    assertEquals(validLicenseHolder(name), false, JSON.stringify(name));
  }
});
