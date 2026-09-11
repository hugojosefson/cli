/** Install the local runner; source remains in this checkout. */
import { fromFileUrl } from "@std/path";
import { runDeno } from "./deno-process.ts";
Deno.exit(
  await runDeno([
    "install",
    "--global",
    "--name",
    "hj",
    ...Deno.args,
    "--config",
    fromFileUrl(new URL("../deno.json", import.meta.url)),
    "--allow-env",
    "--allow-run=deno",
    "--allow-read",
    new URL("./run-cli.ts", import.meta.url).href,
  ]),
);
