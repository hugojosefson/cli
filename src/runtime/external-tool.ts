/** @module Check required executables without confusing a missing working directory. */
import { runCommand } from "./command.ts";
import { isNotFound } from "./errors.ts";

const tools = {
  git: { name: "Git", url: "https://git-scm.com/downloads/" },
  gh: { name: "GitHub CLI", url: "https://cli.github.com/" },
} as const;

export class ExternalToolError extends Error {}

/** Probe the executable itself before passing a repository working directory. */
export async function requireExternalTool(
  command: keyof typeof tools,
  run: typeof runCommand = runCommand,
): Promise<void> {
  const tool = tools[command];
  let result;
  try {
    result = await run(command, { args: ["--version"] });
  } catch (cause) {
    if (!isNotFound(cause)) throw cause;
    throw new ExternalToolError(
      `${tool.name} (${command}) is required. Install it from ${tool.url}, add ${command} to PATH, then retry.`,
      { cause },
    );
  }
  if (!result.success) {
    throw new ExternalToolError(
      `${tool.name} (${command}) could not run --version (exit ${result.code}). Repair its installation using ${tool.url}, then retry.`,
    );
  }
}
