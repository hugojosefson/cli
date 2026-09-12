import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import { assert, assertEquals, assertFalse } from "@std/assert";
import { AuthenticatedJsrScopeReader } from "./jsr-scope-reader.ts";

test("JSR discovery reads every actual membership through bearer authentication", async () => {
  const reader = new AuthenticatedJsrScopeReader(
    () => "secret-user-token",
    (url, init) => {
      assertEquals(url, "https://api.jsr.io/user/scopes");
      assertEquals(
        new Headers(init?.headers).get("Authorization"),
        "Bearer secret-user-token",
      );
      assertEquals(init?.redirect, "error");
      assert(new Headers(init?.headers).get("User-Agent")?.startsWith("hj/"));
      return Promise.resolve(
        Response.json([{ scope: "team", isAdmin: false }, {
          scope: "acme",
          isAdmin: true,
        }, { scope: "team" }]),
      );
    },
  );
  assertEquals(await reader.scopes(), {
    kind: "available",
    scopes: ["acme", "team"],
  });
});

test("JSR discovery distinguishes missing authentication, zero memberships, and failures", async () => {
  for (const token of [undefined, "", "  "]) {
    const reader = new AuthenticatedJsrScopeReader(() => token, () => {
      throw new Error("must not request");
    });
    assertEquals(await reader.scopes(), { kind: "missing-authentication" });
  }
  assertEquals(
    await new AuthenticatedJsrScopeReader(
      () => "token",
      () => Promise.resolve(Response.json([])),
    ).scopes(),
    { kind: "available", scopes: [] },
  );
  for (const status of [401, 403, 429, 500]) {
    const result = await new AuthenticatedJsrScopeReader(
      () => "secret-token",
      () => Promise.resolve(new Response("secret-token", { status })),
    ).scopes();
    assertEquals(result.kind, "unavailable");
    assertFalse(JSON.stringify(result).includes("secret-token"));
    assert(JSON.stringify(result).includes(`HTTP ${status}`));
  }
  for (
    const body of [{ scopes: [] }, ["acme"], [null], [{ scope: "@acme" }], [{
      scope: "acme",
    }, {}]]
  ) {
    assertEquals(
      (await new AuthenticatedJsrScopeReader(
        () => "token",
        () => Promise.resolve(Response.json(body)),
      ).scopes()).kind,
      "unavailable",
    );
  }
  for (
    const request of [
      () => Promise.resolve(new Response("secret-token invalid JSON")),
      () => Promise.reject(new Error("secret-token transport error")),
    ]
  ) {
    const result = await new AuthenticatedJsrScopeReader(
      () => "secret-token",
      request,
    ).scopes();
    assertEquals(result.kind, "unavailable");
    assertFalse(JSON.stringify(result).includes("secret-token"));
  }
  const result = await new AuthenticatedJsrScopeReader(() => {
    throw new Error("secret-token denied environment");
  }).scopes();
  assertEquals(result.kind, "unavailable");
  assertFalse(JSON.stringify(result).includes("secret-token"));
});
