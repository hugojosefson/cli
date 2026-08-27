import { ChangePlanError } from "./change-plan-error.ts";

/** Creates a directory or accepts an existing directory, never another kind. */
export async function createDirectory(url: URL, path: string): Promise<void> {
  try {
    if ((await Deno.lstat(url)).isDirectory) return;
    throw new ChangePlanError("expected-state", path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return await Deno.mkdir(url);
    throw error;
  }
}
