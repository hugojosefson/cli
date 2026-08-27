/** @module Shared command dispatch for the `hj` CLI. */

import { builtInFeatureRegistry } from "../features/built-in-feature-registry.ts";
import { buildReadme } from "../readme/build-readme.ts";
import { parseFeatures } from "./parse-features.ts";
import { runFeatures } from "./run-features.ts";

export interface CliResult {
  readonly output: string;
  readonly terminalNewline: boolean;
}

export async function runCli(
  root: URL,
  args: readonly string[],
): Promise<CliResult> {
  if (args[0] === "repo" && args[1] === "features") {
    return {
      output: await runFeatures(
        root,
        parseFeatures(args, builtInFeatureRegistry),
      ),
      terminalNewline: true,
    };
  }
  if (args[0] === "readme" && args[1] === "build") {
    if (args.length > 3) throw new Error("expected `hj readme build [input]`");
    return { output: await buildReadme(root, args[2]), terminalNewline: false };
  }
  throw new Error("expected `hj repo features` or `hj readme build [input]`");
}
