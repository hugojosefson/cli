/** Run the separately locked native distribution toolchain without publishing. */
import { fileURLToPath } from "node:url";
import { runDeno } from "./deno-process.ts";
const result = await runDeno([
  "run",
  "--frozen",
  "--check",
  "--config",
  fileURLToPath(new URL("./npm-build/deno.json", import.meta.url)),
  "--allow-all",
  fileURLToPath(new URL("./npm-build/build.ts", import.meta.url)),
]);
Deno.exit(result);
