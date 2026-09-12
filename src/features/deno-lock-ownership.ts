/** @module Explicit ownership records for the shared Deno lock policy. */
import type { FileReader } from "../api/repository-context.ts";

export const denoLockOwnershipPath = ".hj/deno-lock.json";
export const denoLockPath = "deno.lock";

export interface DenoLockOwnership {
  readonly version: 1;
  readonly configPath: string;
  readonly lock: boolean;
  /** Keeps a pre-existing explicit requirement after application features leave. */
  readonly explicit?: true;
  readonly digest?: string;
}

export function denoLockOwnershipText(state: DenoLockOwnership): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}

/** Unknown or edited ownership records never grant ownership. */
export async function readDenoLockOwnership(
  files: FileReader,
): Promise<DenoLockOwnership | undefined> {
  const text = await files.readText(denoLockOwnershipPath);
  if (text === undefined) return undefined;
  try {
    const value = JSON.parse(text);
    if (
      value.version !== 1 ||
      !["deno.json", "deno.jsonc"].includes(value.configPath) ||
      typeof value.lock !== "boolean" ||
      (value.explicit !== undefined && value.explicit !== true) ||
      (value.digest !== undefined &&
        (typeof value.digest !== "string" ||
          !/^[a-f0-9]{64}$/.test(value.digest))) ||
      Object.keys(value).some((key) =>
        !["version", "configPath", "lock", "explicit", "digest"].includes(key)
      )
    ) return undefined;
    return value;
  } catch {
    return undefined;
  }
}
