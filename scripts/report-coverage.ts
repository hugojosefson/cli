/** One source filter for text, HTML, and coverage threshold checks. */
import { runDeno } from "./deno-process.ts";
const source = RegExp.escape(new URL("../src/", import.meta.url).href);
Deno.exit(
  await runDeno([
    "coverage",
    ".coverage",
    `--include=^${source}`,
    "--exclude=_test[.]ts$,test-fixtures[.]ts$",
    ...Deno.args,
  ]),
);
