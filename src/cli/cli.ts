/** Local executable entry point. Run with `deno task hj`. */
import { toFileUrl } from "@std/path";
import { formatCliOutput } from "./format-output.ts";
import { formatCliError, terminalColor } from "./terminal-colors.ts";
import { runCli } from "./run-cli.ts";
import { CommandFailure } from "./command-failure.ts";

try {
  const result = await runCli(toFileUrl(Deno.cwd()), Deno.args, {
    colors: {
      stdout: terminalColor(Deno.stdout),
      stderr: terminalColor(Deno.stderr),
    },
  });
  await Deno.stdout.write(new TextEncoder().encode(formatCliOutput(result)));
} catch (error) {
  console.error(formatCliError(error, terminalColor(Deno.stderr)));
  Deno.exit(error instanceof CommandFailure ? error.exitCode : 1);
}
