import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import { assertEquals, assertRejects } from "@std/assert";
import { createMitTextSource, mitSourceUrl } from "./license-mit-source.ts";

test("MIT source uses pinned URL, validates placeholders, and caches", async () => {
  let calls = 0;
  const source = createMitTextSource((url) => {
    calls++;
    assertEquals(String(url), mitSourceUrl);
    return Promise.resolve(
      new Response("<year> <copyright holders>", { status: 200 }),
    );
  });
  await source();
  await source();
  assertEquals(calls, 1);
  await assertRejects(() =>
    createMitTextSource(() =>
      Promise.resolve(new Response("<year>", { status: 200 }))
    )()
  );
  await assertRejects(() =>
    createMitTextSource(() =>
      Promise.resolve(new Response("no", { status: 503 }))
    )()
  );
});
