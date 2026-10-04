/** @module CLI version output from package metadata. */
import metadata from "../../deno.json" with { type: "json" };
import type { CliResult } from "./cli-result.ts";

export function runVersion(args: readonly string[]): CliResult {
  if (args.length !== 1) {
    throw new Error("Expected `hj --version` or `hj version`.");
  }
  return { output: metadata.version, terminalNewline: true };
}
