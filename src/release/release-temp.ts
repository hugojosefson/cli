/** @module Bounded temporary directories for release Git indexes. */

const releaseTempRoot = "/tmp/opencode";

export async function makeReleaseTempDir(prefix: string): Promise<string> {
  await Deno.mkdir(releaseTempRoot, { recursive: true });
  return await Deno.makeTempDir({ dir: releaseTempRoot, prefix });
}
