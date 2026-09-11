/** @module Root-bound subprocess access for release commands. */

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
      const child = new Deno.Command(command, {
        args: [...args],
        cwd: options.cwd ?? root,
        env: options.env ? { ...options.env } : undefined,
        stdin: options.stdin === undefined ? "null" : "piped",
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      if (options.stdin !== undefined) {
        const writer = child.stdin.getWriter();
        await writer.write(new TextEncoder().encode(options.stdin));
        await writer.close();
      }
      return await child.output();
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
    throw new Error(`Release command failed: ${command}.`);
  }
  return processText(result);
}
