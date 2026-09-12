import { fileURLToPath } from "node:url";
/** Build native tests with the same separately pinned emitter as the npm CLI. */
import { runDeno } from "./deno-process.ts";
Deno.exit(
  await runDeno([
    "run",
    "--allow-all",
    "--check",
    "--frozen",
    "--config",
    fileURLToPath(new URL("./npm-build/deno.json", import.meta.url)),
    fileURLToPath(new URL("./test-build/build.ts", import.meta.url)),
  ]),
);
