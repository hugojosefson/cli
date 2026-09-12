import { isNotFound } from "../runtime/errors.ts";
import * as fs from "node:fs/promises";
import { ChangePlanError } from "./change-plan-error.ts";

/** Creates a directory or accepts an existing directory, never another kind. */
export async function createDirectory(url: URL, path: string): Promise<void> {
  try {
    if ((await fs.lstat(url)).isDirectory()) return;
    throw new ChangePlanError("expected-state", path);
  } catch (error) {
    if (isNotFound(error)) return await fs.mkdir(url);
    throw error;
  }
}
