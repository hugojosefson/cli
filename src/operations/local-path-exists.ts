import { isNotFound } from "../runtime/errors.ts";
import * as fs from "node:fs/promises";
export async function pathExists(url: URL): Promise<boolean> {
  try {
    await fs.lstat(url);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}
