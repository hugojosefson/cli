import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import { assertEquals, assertRejects } from "@std/assert";
import {
  apacheSourceUrl,
  createApacheTextSource,
} from "./license-apache-2.0-source.ts";

test("Apache source uses its pinned URL, placeholders, cache, and errors", async () => {
  let calls = 0;
  const source = createApacheTextSource((url) => {
    calls++;
    assertEquals(String(url), apacheSourceUrl);
    return Promise.resolve(
      new Response("[yyyy] [name of copyright owner]", { status: 200 }),
    );
  });
  await source();
  await source();
  assertEquals(calls, 1);
  await assertRejects(() =>
    createApacheTextSource(() =>
      Promise.resolve(new Response("[yyyy]", { status: 200 }))
    )()
  );
  await assertRejects(() =>
    createApacheTextSource(() =>
      Promise.resolve(new Response("no", { status: 503 }))
    )()
  );
});
