/** Validate the package without authentication or upload. */
import { runDeno } from "./deno-process.ts";
Deno.exit(
  await runDeno([
    "publish",
    "--dry-run",
    "--allow-dirty",
    "--check=all",
    "--frozen",
  ]),
);
