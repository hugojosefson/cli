/** @module Sign in only when a requested GitHub operation needs authentication. */
import { stderr, stdin, stdout } from "node:process";
import { runCommand } from "../runtime/command.ts";
import { requireExternalTool } from "../runtime/external-tool.ts";
import { promptTerminalText } from "./terminal-prompt.ts";
import { PromptCancelled } from "./prompt-cancelled.ts";

export interface GithubAuthenticationServices {
  readonly run?: typeof runCommand;
  readonly terminal?: { input: boolean; output: boolean; error: boolean };
  readonly prompt?: (message: string) => Promise<string | null>;
}

/** Never read redirected input or allow --yes to answer the login prompt. */
export async function ensureGithubAuthentication(
  root: URL,
  services: GithubAuthenticationServices = {},
): Promise<void> {
  const run = services.run ?? runCommand;
  await requireExternalTool("gh", run);
  const status = () =>
    run("gh", {
      args: ["auth", "status", "--active"],
      cwd: root,
    });
  if ((await status()).success) return;
  const terminal = services.terminal ?? {
    input: Boolean(stdin.isTTY),
    output: Boolean(stdout.isTTY),
    error: Boolean(stderr.isTTY),
  };
  const retry = "GitHub sign-in is required for this operation. " +
    "Run `gh auth login` in a terminal, then retry. " +
    "For unattended runs, configure GH_TOKEN through your environment's secret store. " +
    "See https://cli.github.com/manual/gh_auth_login.";
  if (!terminal.input || !terminal.output || !terminal.error) {
    throw new Error(retry);
  }
  const answer = await (services.prompt ?? promptTerminalText)(
    "This operation needs GitHub access. Run gh auth login now? Type yes to continue",
  );
  if (answer === null) throw new PromptCancelled();
  if (answer.trim().toLowerCase() !== "yes") throw new Error(retry);
  const result = await run("gh", {
    args: ["auth", "login"],
    cwd: root,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  if (!result.success || !(await status()).success) throw new Error(retry);
}
