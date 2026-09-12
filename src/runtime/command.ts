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
  readonly signal?: AbortSignal;
  readonly stdin?: "null" | "inherit";
  readonly stdout?: "piped" | "inherit";
  readonly stderr?: "piped" | "inherit";
}

interface DenoCommandConstructor {
  new (command: string, options: {
    args: string[];
    signal?: AbortSignal;
    cwd?: string | URL;
    env?: Readonly<Record<string, string>>;
    stdin: "null" | "inherit" | "piped";
    stdout: "piped" | "inherit";
    stderr: "piped" | "inherit";
  }): {
    spawn(): {
      stdin: WritableStream<Uint8Array>;
      output(): Promise<CommandResult>;
      kill(): void;
    };
  };
}

/** Resolve genuine Deno tasks without involving ordinary native commands. */
export async function runCommand(
  command: string,
  options: CommandOptions = {},
): Promise<CommandResult> {
  if (command === "deno") {
    const { runExternalDeno } = await import("./external-deno.ts");
    return await runExternalDeno(options);
  }
  return await runRawCommand(command, options);
}

/** Keep Deno's narrow permission grants; its node spawn adapter reads all env. */
export async function runRawCommand(
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
      } catch (error) {
        try {
          child.kill();
        } catch {
          // The child may already have exited after closing its input.
        }
        throw error;
      } finally {
        writer.releaseLock();
      }
    };
    // Drain output while writing, so large bidirectional streams cannot deadlock.
    const [output, input] = await Promise.allSettled(
      [child.output(), writeInput()] as const,
    );
    options.signal?.throwIfAborted();
    if (output.status === "rejected") throw output.reason;
    if (input.status === "rejected") throw input.reason;
    const result = output.value;
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
      signal: options.signal,
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
    let failure: Error | undefined;
    child.on("error", (error) => {
      failure = error;
    });
    child.stdin?.on("error", (error) => {
      failure = error;
      child.kill();
    });
    child.on("close", (code, signal) => {
      if (options.signal?.aborted) {
        reject(options.signal.reason);
        return;
      }
      if (failure) {
        reject(failure);
        return;
      }
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
