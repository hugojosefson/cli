/** @module Read-only access checks and permission requirements for repository files. */
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import process from "node:process";
import { runRawCommand } from "../runtime/command.ts";
import { fileURLToPath } from "node:url";

import type { FileAccess } from "../api/file-access.ts";

type FilePermissions = { readonly mode: number; readonly access?: FileAccess };

/** Observe access without opening for writing or changing files/directories. */
export async function inspectFileAccess(
  path: URL,
  info: { readonly uid: number; readonly gid: number },
): Promise<FileAccess> {
  // Deno's node:fs access shim ignores supplementary groups and ACLs.
  // POSIX test asks the OS without opening for writing. Node/Bun use native access.
  const [readable, writable, executable] =
    process.versions.deno && process.platform !== "win32"
      ? await shellAccess(path)
      : await Promise.all(
        [constants.R_OK, constants.W_OK, constants.X_OK].map(async (flag) => {
          try {
            await fs.access(path, flag);
            return true;
          } catch (error) {
            if (
              error instanceof Error && "code" in error &&
              (error.code === "EACCES" || error.code === "EPERM" ||
                error.code === "EROFS")
            ) return false;
            throw error;
          }
        }),
      );
  const shift = process.getuid?.() === info.uid
    ? 6
    : process.getgid?.() === info.gid ||
        process.getgroups?.().includes(info.gid)
    ? 3
    : 0;
  return { readable, writable, executable, shift };
}

/** Synthetic observations without access metadata describe owner permissions. */
export function fileAccess(file: FilePermissions): FileAccess {
  return file.access ?? accessFromMode(file.mode);
}

/** Predict a chmod result for the current user's permission class. */
export function accessFromMode(mode: number, shift = 6): FileAccess {
  const bits = mode >> shift;
  return {
    readable: !!(bits & 4),
    writable: !!(bits & 2),
    executable: !!(bits & 1),
    shift,
  };
}

/** Templates specify required access, not exact group/other sharing permissions. */
export function matchesFileAccess(
  file: FilePermissions,
  template: number,
): boolean {
  const actual = fileAccess(file);
  const expected = accessFromMode(template);
  return actual.readable === expected.readable &&
    actual.writable === expected.writable &&
    actual.executable === expected.executable;
}

/** Change only the current user's required access; preserve unrelated bits. */
export function repairFileMode(
  file: FilePermissions,
  template: number,
): number {
  const shift = fileAccess(file).shift;
  return (file.mode & ~(7 << shift)) | (((template >> 6) & 7) << shift);
}

async function shellAccess(path: URL): Promise<boolean[]> {
  const result = await runRawCommand("sh", {
    args: [
      "-c",
      'for flag in r w x; do if test -"$flag" "$1"; then printf 1; else printf 0; fi; done',
      "hj-file-access",
      fileURLToPath(path),
    ],
    env: { LD_LIBRARY_PATH: "", LD_PRELOAD: "" },
  });
  if (!result.success) {
    throw new Error("Cannot inspect filesystem access with sh.");
  }
  const stdout = new TextDecoder().decode(result.stdout);
  if (!/^[01]{3}$/.test(stdout)) {
    throw new Error("Invalid filesystem access response from sh.");
  }
  return [...stdout].map((bit) => bit === "1");
}
