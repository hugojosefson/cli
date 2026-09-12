/** @module Native subprocesses with the same inherited environment and streams. */
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import process from "node:process";
import { constants } from "node:os";

export interface CommandResult {
  readonly success: boolean;
  readonly code: number;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
}

export interface CommandOptions {
  readonly args?: readonly string[];
  readonly cwd?: string | URL;
  readonly env?: Readonly<Record<string, string>>;
  readonly input?: string | Uint8Array;
  readonly stdin?: "null" | "inherit";
  readonly stdout?: "piped" | "inherit";
  readonly stderr?: "piped" | "inherit";
}

interface DenoCommandConstructor {
  new (command: string, options: {
    args: string[];
    cwd?: string | URL;
    env?: Readonly<Record<string, string>>;
    stdin: "null" | "inherit" | "piped";
    stdout: "piped" | "inherit";
    stderr: "piped" | "inherit";
  }): {
    spawn(): {
      stdin: WritableStream<Uint8Array>;
      output(): Promise<CommandResult>;
    };
  };
}

/** Keep Deno's narrow permission grants; its node spawn adapter reads all env. */
export async function runCommand(
  command: string,
  options: CommandOptions = {},
): Promise<CommandResult> {
  const deno = (globalThis as {
    Deno?: { Command: DenoCommandConstructor };
  }).Deno;
  if (deno) {
    const child = new deno.Command(command, {
      ...options,
      args: options.args ? [...options.args] : [],
      stdin: options.input === undefined ? options.stdin ?? "null" : "piped",
      stdout: options.stdout ?? "piped",
      stderr: options.stderr ?? "piped",
    }).spawn();
    const writeInput = async () => {
      if (options.input === undefined) return;
      const writer = child.stdin.getWriter();
      try {
        await writer.write(
          typeof options.input === "string"
            ? new TextEncoder().encode(options.input)
            : options.input,
        );
        await writer.close();
      } finally {
        writer.releaseLock();
      }
    };
    // Drain output while writing, so large bidirectional streams cannot deadlock.
    const [result] = await Promise.all([child.output(), writeInput()]);
    return {
      success: result.success,
      code: result.code,
      stdout: options.stdout === "inherit" ? new Uint8Array() : result.stdout,
      stderr: options.stderr === "inherit" ? new Uint8Array() : result.stderr,
    };
  }
  return await new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, [...options.args ?? []], {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : undefined,
      stdio: [
        options.input === undefined
          ? options.stdin === "inherit" ? "inherit" : "ignore"
          : "pipe",
        options.stdout === "inherit" ? "inherit" : "pipe",
        options.stderr === "inherit" ? "inherit" : "pipe",
      ],
    });
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];
    child.stdout?.on("data", (chunk: Uint8Array) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Uint8Array) => stderr.push(chunk));
    child.on("error", reject);
    child.stdin?.on("error", reject);
    child.on("close", (code, signal) => {
      const exitCode = code ?? (signal ? 128 + constants.signals[signal] : 1);
      resolve({
        success: exitCode === 0,
        code: exitCode,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      });
    });
    if (options.input !== undefined) child.stdin!.end(options.input);
  });
}
