/** GitHub subprocess transport and credential-free failure diagnostics. */
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
  return {
    async run(args, stdin) {
      const child = new Deno.Command("gh", {
        args: [...args],
        cwd: root,
        stdin: stdin === undefined ? "null" : "piped",
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      if (stdin !== undefined) {
        const writer = child.stdin.getWriter();
        await writer.write(new TextEncoder().encode(stdin));
        await writer.close();
      }
      return await child.output();
    },
  };
}

/** Report only classified metadata; arguments and raw stderr can contain secrets. */
export function githubCommandFailure(
  args: readonly string[],
  result?: GithubCommandResult,
): string {
  const command = args[0] === "api" ? "API request" : "repository lookup";
  const status = result?.stderr &&
    /\bHTTP ([1-5][0-9]{2})\b/.exec(new TextDecoder().decode(result.stderr))
      ?.[1];
  const exit = result?.code;
  const details = [
    ...(status ? [`HTTP ${status}`] : []),
    ...(Number.isInteger(exit) ? [`exit ${exit}`] : []),
  ];
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
    : "Could not start the GitHub CLI. Check that `gh` is installed and can run.";
}
