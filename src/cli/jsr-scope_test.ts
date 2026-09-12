import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  context,
  withRepository,
  writeConfig,
} from "../features/jsr-package-test-fixtures.ts";
import type {
  JsrScopeReader,
  JsrScopes,
} from "../repository/jsr-scope-reader.ts";
import { resolveJsrScope } from "./jsr-scope.ts";
import { parseFeatures } from "./parse-features.ts";
import { builtInFeatureRegistry } from "../features/built-in-feature-registry.ts";

const scopes = (...names: string[]): JsrScopeReader => ({
  scopes: () => Promise.resolve({ kind: "available", scopes: names }),
});
const neverPrompt = () => {
  throw new Error("unexpected selection prompt");
};

test("one JSR membership selects automatically; several require an explicit answer", async () => {
  await withRepository(async (root) => {
    assertEquals(
      await resolveJsrScope(
        context(root),
        scopes("member"),
        undefined,
        neverPrompt,
      ),
      { jsrScope: "member" },
    );
    assertEquals(
      await resolveJsrScope(
        context(root),
        scopes("member", "admin"),
        undefined,
        (available) => {
          assertEquals(available, ["member", "admin"]);
          return "admin";
        },
      ),
      { jsrScope: "admin" },
    );
    for (const prompt of [undefined, () => null, () => "", () => "unknown"]) {
      await assertRejects(
        () =>
          resolveJsrScope(
            context(root),
            scopes("member", "admin"),
            undefined,
            prompt,
          ),
        Error,
        "--jsr-scope=<scope>. Available scopes: member, admin",
      );
    }
  });
});

test("explicit and configured JSR scopes remain authoritative and validate membership", async () => {
  await withRepository(async (root) => {
    assertEquals(
      await resolveJsrScope(
        context(root),
        scopes("member", "admin"),
        "member",
        neverPrompt,
      ),
      { jsrScope: "member" },
    );
    await assertRejects(
      () =>
        resolveJsrScope(
          context(root),
          scopes("member"),
          "outsider",
          neverPrompt,
        ),
      Error,
      "not a member",
    );
    await assertRejects(
      () => resolveJsrScope(context(root), scopes(), "outsider", neverPrompt),
      Error,
      "Available scopes: none",
    );
    await assertRejects(
      () =>
        resolveJsrScope(
          context(root),
          scopes("member"),
          "@member",
          neverPrompt,
        ),
      Error,
      "valid JSR scope",
    );
    await writeConfig(root, { name: "@admin/my-tool" });
    assertEquals(
      await resolveJsrScope(
        context(root),
        scopes("member", "admin"),
        undefined,
        neverPrompt,
      ),
      { jsrScope: "admin" },
    );
    assertEquals(
      await resolveJsrScope(
        context(root),
        scopes("admin"),
        "admin",
        neverPrompt,
      ),
      { jsrScope: "admin" },
    );
    await assertRejects(
      () =>
        resolveJsrScope(
          context(root),
          scopes("member", "admin"),
          "member",
          neverPrompt,
        ),
      Error,
      "conflicts",
    );
    await assertRejects(
      () =>
        resolveJsrScope(
          context(root),
          scopes("member"),
          undefined,
          neverPrompt,
        ),
      Error,
      "not a member",
    );
    await writeConfig(root, { name: "unscoped" });
    await assertRejects(
      () =>
        resolveJsrScope(
          context(root),
          scopes("member"),
          undefined,
          neverPrompt,
        ),
      Error,
      "explicit scoped",
    );
  });
});

test("unresolved JSR discovery differs from no memberships and never guesses a username", async () => {
  await withRepository(async (root) => {
    await assertRejects(
      () => resolveJsrScope(context(root), scopes(), undefined, neverPrompt),
      Error,
      "A JSR scope is needed",
    );
    const missing: JsrScopeReader = {
      scopes: () => Promise.resolve({ kind: "missing-authentication" }),
    };
    await assertRejects(
      () => resolveJsrScope(context(root), missing, undefined, neverPrompt),
      Error,
      "discovery is unresolved: set JSR_TOKEN",
    );
    assertEquals(
      await resolveJsrScope(context(root), missing, "explicit", neverPrompt),
      { jsrScope: "explicit" },
    );
    const failure: JsrScopes = { kind: "unavailable", observation: "HTTP 403" };
    for (const explicit of [undefined, "explicit"]) {
      await assertRejects(
        () =>
          resolveJsrScope(
            context(root),
            { scopes: () => Promise.resolve(failure) },
            explicit,
            neverPrompt,
          ),
        Error,
        "discovery is unresolved: HTTP 403",
      );
    }
    await writeConfig(root, { name: "@configured/package" });
    assertEquals(
      await resolveJsrScope(context(root), missing, undefined, neverPrompt),
      { jsrScope: "configured" },
    );
  });
});

test("JSR scope CLI input rejects malformed, conflicting, and unused arguments", () => {
  const parse = (...flags: string[]) =>
    parseFeatures(["repo", "features", ...flags], builtInFeatureRegistry);
  assertEquals("jsrScope" in parse("--jsr-package", "--jsr-scope=acme"), true);
  assertEquals("jsrScope" in parse("--jsr", "--jsr-scope=acme"), true);
  for (
    const flags of [
      ["--jsr-scope=acme"],
      ["--jsr-scope="],
      ["--jsr-scope=@acme", "--jsr"],
      ["--jsr-scope=acme", "--jsr-scope=acme", "--jsr"],
      ["--jsr-scope=acme", "--interactive"],
      ["--jsr-scope=acme", "--no-jsr-package"],
      ["--jsr-scope=acme", "--jsr", "--no-jsr-package"],
    ]
  ) assertThrows(() => parse(...flags));
});
