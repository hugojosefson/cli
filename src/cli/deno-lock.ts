/** @module Refresh explicitly managed dependency locks before frozen checks. */
import { runCommand } from "../runtime/command.ts";
import * as fs from "node:fs/promises";
import { LocalFileReader } from "../repository/local-file-reader.ts";
import { repositoryRoot } from "../repository/repository-path.ts";
import { inspectDenoConfig } from "../features/deno-config.ts";
import {
  denoLockOwnershipPath,
  denoLockOwnershipText,
  denoLockPath,
  readDenoLockOwnership,
} from "../features/deno-lock-policy.ts";

/** Returns only paths whose contents this invocation is authorized to own. */
export async function prepareDenoLock(root: URL): Promise<readonly string[]> {
  const files = new LocalFileReader(root, false);
  const state = await readDenoLockOwnership(files);
  const config = await inspectDenoConfig({ files });
  if (
    !state?.lock || config.kind !== "config" ||
    config.path !== state.configPath || config.value.lock !== true
  ) return [];
  const lock = await files.observe(denoLockPath);
  if (
    lock.kind !== "absent" &&
    !(lock.kind === "file" && lock.digest === state.digest)
  ) return [];
  const roots = await sourceFiles(root);
  if (roots.length) {
    const result = await runCommand("deno", {
      args: [
        "cache",
        "--allow-import",
        "--frozen=false",
        "--lock=deno.lock",
        ...roots,
      ],
      cwd: repositoryRoot(root).path,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    });
    if (!result.success) {
      throw new Error(
        `Deno lockfile generation failed (exit ${result.code}): ${
          new TextDecoder().decode(result.stderr).trim()
        }`,
      );
    }
  }
  // Deno omits an empty lockfile when the graph has no dependencies.
  if ((await files.observe(denoLockPath)).kind === "absent") {
    await fs.writeFile(
      new URL(denoLockPath, root),
      '{\n  "version": "5"\n}\n',
    );
  }
  await refreshDenoLock(root);
  return [denoLockPath, denoLockOwnershipPath];
}

/** Call only after prepareDenoLock granted ownership for this operation. */
export async function refreshDenoLock(root: URL): Promise<void> {
  const files = new LocalFileReader(root, false);
  const state = await readDenoLockOwnership(files);
  if (!state?.lock) return;
  const lock = await files.observe(denoLockPath);
  if (lock.kind !== "file") {
    throw new Error("The managed deno.lock is no longer a regular file.");
  }
  await fs.writeFile(
    new URL(denoLockOwnershipPath, root),
    denoLockOwnershipText({ ...state, digest: lock.digest }),
  );
}

async function sourceFiles(root: URL): Promise<string[]> {
  const paths: string[] = [];
  async function visit(directory: URL, prefix: string) {
    for await (
      const entry of await fs.readdir(directory, { withFileTypes: true })
    ) {
      if (
        entry.name.startsWith(".") ||
        ["node_modules", "vendor", "coverage"].includes(entry.name)
      ) continue;
      const path = `${prefix}${entry.name}`;
      if (entry.isDirectory()) {
        await visit(
          new URL(`${encodeURIComponent(entry.name)}/`, directory),
          `${path}/`,
        );
      } else if (entry.isFile() && /\.(?:[cm]?[jt]sx?)$/.test(entry.name)) {
        paths.push(`./${path}`);
      }
    }
  }
  await visit(root, "");
  return paths.sort();
}
