/** Portable filesystem operations shared by test fixtures. */
import { lstat, mkdtemp, readdir, readFile, stat } from "node:fs/promises";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
export {
  chmod,
  mkdir,
  realpath as realPath,
  rename,
  rm as remove,
  symlink,
  writeFile as writeTextFile,
} from "node:fs/promises";
export { writeFileSync as writeTextFileSync } from "node:fs";
export const readTextFile = (path: string | URL): Promise<string> =>
  readFile(path, "utf8");
export const readTextFileSync = (path: string | URL): string =>
  readFileSync(path, "utf8");
export const makeTempDir = (
  options: { dir?: string; prefix?: string } = {},
): Promise<string> =>
  mkdtemp(join(options.dir ?? tmpdir(), options.prefix ?? "hj-test-"));
function info(value: NonNullable<Awaited<ReturnType<typeof stat>>>) {
  return {
    mode: Number(value.mode),
    size: Number(value.size),
    isFile: value.isFile(),
    isDirectory: value.isDirectory(),
    isSymlink: value.isSymbolicLink(),
  };
}
export const fixtureStat = async (path: string | URL) => info(await stat(path));
export const fixtureLstat = async (path: string | URL) =>
  info(await lstat(path));
export function fixtureReadDirSync(path: string | URL) {
  return readdirSync(path, { withFileTypes: true }).map((value) => ({
    name: value.name,
    isFile: value.isFile(),
    isDirectory: value.isDirectory(),
    isSymlink: value.isSymbolicLink(),
  }));
}
export async function* fixtureReadDir(path: string | URL) {
  for (const value of await readdir(path, { withFileTypes: true })) {
    yield {
      name: value.name,
      isFile: value.isFile(),
      isDirectory: value.isDirectory(),
      isSymlink: value.isSymbolicLink(),
    };
  }
}

/** Check the precise missing-file failure rather than accepting any rejection. */
export async function assertMissingFile(
  action: () => Promise<unknown>,
): Promise<void> {
  const { rejects } = await import("node:assert/strict");
  await rejects(
    action,
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "ENOENT",
  );
}
