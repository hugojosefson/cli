/** Local executable entry point. Run with `deno task hj`. */
import process from "node:process";
import { toFileUrl } from "@std/path";
import { formatCliOutput } from "./format-output.ts";
import { formatCliError, terminalColor } from "./terminal-colors.ts";
import { runCli } from "./run-cli.ts";
import { PromptCancelled } from "./prompt-cancelled.ts";
import { CommandFailure } from "./command-failure.ts";

try {
  const result = await runCli(toFileUrl(process.cwd()), process.argv.slice(2), {
    colors: {
      stdout: terminalColor(process.stdout),
      stderr: terminalColor(process.stderr),
    },
  });
  process.stdout.write(formatCliOutput(result));
} catch (error) {
  if (error instanceof PromptCancelled) {
    process.exitCode = 0;
  } else {
    console.error(formatCliError(error, terminalColor(process.stderr)));
    process.exitCode = error instanceof CommandFailure ? error.exitCode : 1;
  }
}
