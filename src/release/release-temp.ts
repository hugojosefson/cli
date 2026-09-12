/** @module Bounded temporary directories for release Git indexes. */
import { makeTempDirectory } from "../runtime/temp.ts";
import * as fs from "node:fs/promises";

const releaseTempRoot = "/tmp/opencode";

export async function makeReleaseTempDir(prefix: string): Promise<string> {
  await fs.mkdir(releaseTempRoot, { recursive: true });
  return await makeTempDirectory({ dir: releaseTempRoot, prefix });
}
