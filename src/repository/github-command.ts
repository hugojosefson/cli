/** GitHub subprocess transport and credential-free failure diagnostics. */
import { runCommand } from "../runtime/command.ts";
import {
  ExternalToolError,
  requireExternalTool,
} from "../runtime/external-tool.ts";
export type GithubCommandResult = {
  readonly success: boolean;
  readonly stdout: Uint8Array;
  readonly code?: number;
  readonly stderr?: Uint8Array;
};

export interface GithubCommandRunner {
  run(args: readonly string[], stdin?: string): Promise<GithubCommandResult>;
}

export function localGithubCommand(root: URL): GithubCommandRunner {
  let available: Promise<void> | undefined;
  return {
    async run(args, stdin) {
      await (available ??= requireExternalTool("gh"));
      const result = await runCommand("gh", {
        args: [...args],
        cwd: root,
        input: stdin,
        stdout: "piped",
        stderr: "piped",
      });

      return result;
    },
  };
}

/** Report only classified metadata; arguments and raw stderr can contain secrets. */
export function githubCommandFailure(
  args: readonly string[],
  result?: GithubCommandResult,
  cause?: unknown,
): string {
  if (cause instanceof ExternalToolError) return cause.message;
  const command = args[0] === "api" ? "API request" : "repository lookup";
  const status = result?.stderr &&
    /\bHTTP ([1-5][0-9]{2})\b/.exec(new TextDecoder().decode(result.stderr))
      ?.[1];
  const exit = result?.code;
  const details = [
    ...(status ? [`HTTP ${status}`] : []),
    ...(Number.isInteger(exit) ? [`exit ${exit}`] : []),
  ];
  if (result) {
    try {
      const body = JSON.parse(new TextDecoder().decode(result.stdout));
      if (
        Array.isArray(body?.errors) &&
        body.errors.some((error: unknown) =>
          error !== null && typeof error === "object" &&
          (("type" in error &&
            ["RATE_LIMIT", "RATE_LIMITED"].includes(String(error.type))) ||
            ("code" in error && error.code === "graphql_rate_limit"))
        )
      ) {
        return "GitHub API rate limit reached. Wait for the limit to reset, then retry.";
      }
    } catch { /* Unknown response bodies remain private. */ }
    if (
      /(?:GraphQL:|gh:) API rate limit (?:already )?exceeded\b/.test(
        new TextDecoder().decode(result.stderr),
      )
    ) {
      return "GitHub API rate limit reached. Wait for the limit to reset, then retry.";
    }
  }
  if (status === "403" && result) {
    try {
      const body = JSON.parse(new TextDecoder().decode(result.stdout));
      if (
        typeof body.message === "string" &&
        body.message.startsWith("API rate limit exceeded")
      ) {
        return "GitHub API rate limit reached. Wait for the limit to reset, then retry.";
      }
      if (
        body.message ===
          "Upgrade to GitHub Pro or make this repository public to enable this feature."
      ) {
        return "GitHub rejected a feature because of the repository's plan or visibility. " +
          "Use a public repository or a GitHub plan that supports this feature.";
      }
    } catch { /* Unknown response bodies remain private. */ }
  }
  return result
    ? `GitHub ${command} failed${
      details.length ? ` (${details.join(", ")})` : ""
    }. Run \`gh auth status\` to check access.`
    : "Could not start the GitHub CLI. Make sure that `gh` can run and the repository directory exists. Install or repair `gh` from https://cli.github.com/, then retry.";
}
