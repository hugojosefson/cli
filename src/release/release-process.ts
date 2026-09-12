/** @module Root-bound subprocess access for release commands. */
import { runCommand } from "../runtime/command.ts";

export type ReleaseProcessResult = {
  readonly success: boolean;
  readonly code: number;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
};

export type ReleaseProcessOptions = {
  readonly cwd?: URL;
  readonly env?: Readonly<Record<string, string>>;
  readonly stdin?: string;
};

export type ReleaseProcess = {
  run(
    command: string,
    args: readonly string[],
    options?: ReleaseProcessOptions,
  ): Promise<ReleaseProcessResult>;
};

export function localReleaseProcess(root: URL): ReleaseProcess {
  return {
    async run(command, args, options = {}) {
      const result = await runCommand(command, {
        args: [...args],
        cwd: options.cwd ?? root,
        env: options.env ? { ...options.env } : undefined,
        input: options.stdin,
        stdout: "piped",
        stderr: "piped",
      });

      return result;
    },
  };
}

export function processText(result: ReleaseProcessResult): string {
  return new TextDecoder().decode(result.stdout);
}

export async function runOrThrow(
  process: ReleaseProcess,
  command: string,
  args: readonly string[],
  options?: ReleaseProcessOptions,
): Promise<string> {
  const result = await process.run(command, args, options);
  if (!result.success) {
    throw new Error(releaseCommandFailure(command, args, result.code));
  }
  return processText(result);
}

/** Identify the failed operation without disclosing arguments or captured output. */
export function releaseCommandFailure(
  command: string,
  args: readonly string[],
  code: number,
): string {
  const operations = new Set([
    "fetch",
    "switch",
    "status",
    "add",
    "commit",
    "push",
    "show",
    "rev-parse",
    "read-tree",
    "write-tree",
    "ls-files",
    "diff",
    "fmt",
    "task",
    "publish",
    "api",
  ]);
  let index = 0;
  while (args[index] === "-c") index += 2;
  const operation = operations.has(args[index]) ? ` ${args[index]}` : "";
  return `Release command failed: ${command}${operation} (exit ${code}).`;
}
