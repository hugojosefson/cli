import { spawnSync } from "node:child_process";
/** Execute application code in the host runtime; keep Deno-only fixtures explicit. */
import process from "node:process";
import { fileURLToPath } from "node:url";
import { runCommand } from "../runtime/command.ts";
import type { CommandOptions } from "../runtime/command.ts";
export const isDeno = Boolean(process.versions.deno);
export const externalDeno = isDeno
  ? process.execPath
  : process.env.HJ_TEST_DENO ?? "deno";
export const runtimeName = isDeno
  ? "deno"
  : process.versions.bun
  ? "bun"
  : "node";
export function executableModule(path: string, base: string): URL {
  return new URL(isDeno ? path : path.replace(/\.ts$/, ".js"), base);
}
export function sourceFile(path: string): URL {
  return new URL(
    path,
    isDeno
      ? new URL("../../", import.meta.url)
      : process.env.HJ_TEST_SOURCE_ROOT,
  );
}
export function runCliProcess(
  args: string[],
  options: CommandOptions = {},
  narrow = false,
) {
  const cli = fileURLToPath(executableModule("../cli/cli.ts", import.meta.url));
  return runCommand(process.execPath, {
    ...options,
    args: isDeno
      ? [
        "run",
        "--frozen",
        "--no-prompt",
        ...(narrow ? [] : ["--allow-all"]),
        "--config",
        fileURLToPath(sourceFile("deno.json")),
        cli,
        ...args,
      ]
      : [cli, ...args],
  });
}
export function runModuleEval(
  code: string,
  args: string[] = [],
  options: CommandOptions = {},
) {
  return runCommand(process.execPath, {
    ...options,
    args: isDeno
      ? ["eval", "--frozen", code, ...args]
      : ["--input-type=module", "--eval", code, "--", ...args],
  });
}
/** eval arguments differ from file execution in Node; use this inside eval fixtures. */
export const evalArgumentsCode =
  `import process from "node:process"; const args = process.versions.deno ? process.argv.slice(2) : process.argv.slice(1);`;

/** Isolated negative runner fixtures must exercise the host's own test command. */
export async function runHostTests(file: string) {
  if (isDeno) {
    return await runCommand(process.execPath, {
      args: ["test", "--no-config", "--no-lock", "--allow-all", file],
    });
  }
  // Even an empty NODE_TEST_CONTEXT makes Node skip a recursively invoked runner.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(
    process.execPath,
    runtimeName === "bun"
      ? ["test", "--timeout=120000", file]
      : ["--test", file],
    { env, timeout: 120000 },
  );
  if (result.error) throw result.error;
  return {
    success: result.status === 0,
    code: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
