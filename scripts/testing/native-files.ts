import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, readlink, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { digest } from "./observation.ts";
import type { NativeFile, NativeFiles } from "./native-types.ts";

export async function nativeFile(path: URL | string): Promise<NativeFile> {
  const before = await lstat(path);
  if (!before.isFile()) {
    throw new Error("Native input must be a regular file");
  }
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  const after = await lstat(path);
  if (
    before.size !== after.size || before.mtimeMs !== after.mtimeMs ||
    before.ctimeMs !== after.ctimeMs
  ) {
    throw new Error("Native input changed during inspection");
  }
  return {
    digest: hash.digest("hex"),
    bytes: before.size,
    mode: before.mode & 0o777,
  };
}

export async function nativeTree(root: URL): Promise<NativeFiles> {
  const base = fileURLToPath(root);
  if (!(await lstat(base.replace(/\/$/, ""))).isDirectory()) {
    throw new Error("Native input must be a directory");
  }
  const files: NativeFiles = {};
  async function visit(directory: string): Promise<void> {
    for (const entry of (await readdir(directory)).sort()) {
      const path = resolve(directory, entry);
      const name = relative(base, path).split(sep).join("/");
      const info = await lstat(path);
      if (info.isDirectory()) {
        files[name + "/"] = {
          digest: "directory",
          mode: info.mode & 0o777,
          bytes: 0,
        };
        await visit(path);
      } else if (info.isSymbolicLink()) {
        const target = await realpath(path);
        if (!target.startsWith(resolve(base) + sep)) {
          throw new Error("Native symbolic link leaves its directory");
        }
        const value = await nativeFile(target);
        files[name] = {
          ...value,
          digest: digest({ link: await readlink(path), value }),
        };
      } else {
        files[name] = await nativeFile(path);
      }
    }
  }
  await visit(base);
  return files;
}
