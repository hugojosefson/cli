/** @module Private temporary paths without runtime-specific globals. */
import { mkdtemp, open } from "node:fs/promises";
import { join } from "node:path";

interface TempOptions {
  readonly dir: string;
  readonly prefix: string;
}

export function makeTempDirectory(options: TempOptions): Promise<string> {
  return mkdtemp(join(options.dir, options.prefix));
}

export async function makeTempFile(options: TempOptions): Promise<string> {
  const path = join(options.dir, options.prefix + crypto.randomUUID());
  const file = await open(path, "wx", 0o600);
  await file.close();
  return path;
}
