/** Local executable entry point. Run with `deno task hj`. */
import { toFileUrl } from "@std/path";
import { formatCliOutput } from "./format-output.ts";
import { runCli } from "./run-cli.ts";

try {
  const result = await runCli(toFileUrl(Deno.cwd()), Deno.args);
  await Deno.stdout.write(new TextEncoder().encode(formatCliOutput(result)));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  Deno.exit(1);
}
