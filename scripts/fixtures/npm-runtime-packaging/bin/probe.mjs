#!/usr/bin/env node
import assert from "node:assert/strict";
import process from "node:process";
import { fromFileUrl, join, toFileUrl } from "@jsr/std__path";

assert.equal("Deno" in globalThis, false);
assert.equal(join("native", "nested", "..", "works"), "native/works");
assert.equal(
  fromFileUrl(toFileUrl("/tmp/path with spaces")),
  "/tmp/path with spaces",
);
if (process.argv.includes("--fail")) {
  throw new Error("expected fixture failure");
}
console.log(JSON.stringify({
  result: "bundled JSR dependency works",
  runtime: process.versions.bun ? "bun" : "node",
  version: process.versions.bun ?? process.versions.node,
}));
