/** @module Local Deno options scoped to one CLI invocation. */
import { AsyncLocalStorage } from "node:async_hooks";

export interface DenoRuntimeOptions {
  readonly requirement?: string;
  readonly preferred?: string;
  readonly offline?: boolean;
  readonly signal?: AbortSignal;
}

const options = new AsyncLocalStorage<DenoRuntimeOptions>();

export function currentDenoOptions(): DenoRuntimeOptions {
  return options.getStore() ?? {};
}

export function withDenoOptions<T>(
  value: DenoRuntimeOptions,
  action: () => T,
): T {
  return options.run(value, action);
}

/** Remove only local runtime options; workflow --deno-version stays untouched. */
export function parseDenoOptions(args: readonly string[]): {
  args: readonly string[];
  options: DenoRuntimeOptions;
} {
  const remaining: string[] = [];
  let requirement: string | undefined;
  let preferred: string | undefined;
  let offline: boolean | undefined;
  let positional = false;
  for (const arg of args) {
    if (arg === "--") positional = true;
    if (positional) {
      remaining.push(arg);
      continue;
    }
    if (arg.startsWith("--runtime-deno=")) {
      if (requirement !== undefined) {
        throw new Error("duplicate --runtime-deno");
      }
      requirement = arg.slice("--runtime-deno=".length);
      if (!requirement) {
        throw new Error("--runtime-deno needs a version or range.");
      }
    } else if (arg.startsWith("--runtime-deno-preferred=")) {
      if (preferred !== undefined) {
        throw new Error("duplicate --runtime-deno-preferred");
      }
      preferred = arg.slice("--runtime-deno-preferred=".length);
      if (!preferred) {
        throw new Error("--runtime-deno-preferred needs an exact version.");
      }
    } else if (arg === "--offline") {
      if (offline !== undefined) throw new Error("duplicate --offline");
      offline = true;
    } else if (arg === "--runtime-deno" || arg === "--runtime-deno-preferred") {
      throw new Error(`${arg} needs an =value.`);
    } else remaining.push(arg);
  }
  if (preferred !== undefined && requirement === undefined) {
    throw new Error("--runtime-deno-preferred requires --runtime-deno.");
  }
  return { args: remaining, options: { requirement, preferred, offline } };
}
