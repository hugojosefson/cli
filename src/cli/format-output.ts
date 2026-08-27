/** @module Exact stdout formatting for shared CLI dispatch results. */

import type { CliResult } from "./run-cli.ts";

export function formatCliOutput(result: CliResult): string {
  return result.terminalNewline
    ? `${result.output.replace(/\n*$/, "")}\n`
    : result.output;
}
