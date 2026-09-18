import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import { assertEquals, assertRejects } from "@std/assert";
import { confirmPublication } from "./confirm-publication.ts";

test("publication confirmation counts registry read time against its limit", async () => {
  let now = 0;
  let calls = 0;
  const confirmed = await confirmPublication(() => {
    calls++;
    now += 7_000;
    return Promise.resolve(false);
  }, {
    now: () => now,
    sleep: (milliseconds) => {
      now += milliseconds;
      return Promise.resolve();
    },
  });
  assertEquals(confirmed, false);
  assertEquals(calls, 6);
  assertEquals(now, 67_000);
});

test("publication conflicts stop before any confirmation delay", async () => {
  let slept = 0;
  await assertRejects(
    () =>
      confirmPublication(() => Promise.reject(new TypeError("conflict")), {
        sleep: (milliseconds) => {
          slept += milliseconds;
          return Promise.resolve();
        },
      }, 600_000),
    TypeError,
    "conflict",
  );
  assertEquals(slept, 0);
});
