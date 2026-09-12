/** Copied beside the emitted application, never published as part of the CLI. */
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import config from "./deno.js";
import toolchain from "./toolchain.js";
import { nextVersion } from "./src/release/fork-version.js";
import { selectTerminalActions } from "./src/cli/terminal-prompt.js";

assert.equal("Deno" in globalThis, false);
assert.equal(config.name, "@hugojosefson/cli");
assert.match(config.version, /^\d+\.\d+\.\d+/);
assert.match(toolchain.deno, /^2\./);
assert.equal(await nextVersion("1.2.3", "patch"), "1.2.4");
const input = Object.assign(new PassThrough(), {
  isTTY: true,
  isRaw: false,
  setRawMode(value) {
    this.isRaw = value;
    return this;
  },
});
const output = new PassThrough();
let answered = false;
output.on("data", (chunk) => {
  if (!answered && chunk.toString().includes("Select feature actions:")) {
    answered = true;
    queueMicrotask(() => {
      input.write(" ");
      input.write("\r");
    });
  }
});
try {
  assert.deepEqual(
    await selectTerminalActions([
      { label: "enable git", value: "enable:git" },
    ], { input, output }),
    ["enable:git"],
  );
  assert.equal(input.isRaw, false);
} finally {
  input.destroy();
  output.destroy();
}
console.log("Native dynamic dependency graph passed");
