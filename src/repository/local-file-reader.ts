/** @module Local read-only implementation of the file reader contract. */
import type { Stats } from "node:fs";
import { isNotFound } from "../runtime/errors.ts";
import * as fs from "node:fs/promises";

import type { ArtifactObservation } from "../api/artifact-inspection.ts";
import type {
  DirectoryStateDigest,
  FileDigest,
  FileMode,
  JsonValue,
  RepositoryPath,
} from "../api/json.ts";
import type { FileJson, FileReader } from "../api/repository-context.ts";
import {
  type RepositoryRoot,
  repositoryRoot,
  repositoryUrl,
} from "./repository-path.ts";
import { digestDirectoryState } from "./directory-state-digest.ts";
import { digestBytes } from "./digest-bytes.ts";
import { fileMode } from "./file-mode.ts";

/** Reads artifacts beneath one local repository root without changing them. */
export class LocalFileReader implements FileReader {
  readonly #root: RepositoryRoot;

  constructor(root: URL) {
    this.#root = repositoryRoot(root);
  }

  async observe(path: RepositoryPath): Promise<ArtifactObservation> {
    const url = repositoryUrl(this.#root, path);
    try {
      await this.#assertContainedParent(url);
      const info = await fs.lstat(url);
      if (info.isSymbolicLink()) {
        return { kind: "symlink", target: await fs.readlink(url) };
      }
      if (info.isDirectory()) {
        return {
          kind: "directory",
          stateDigest: await this.directoryStateDigest(
            path,
          ) as DirectoryStateDigest,
        };
      }
      if (info.isFile()) {
        const bytes = await fs.readFile(url);
        return {
          kind: "file",
          content: new TextDecoder().decode(bytes),
          digest: await digestBytes(bytes),
          mode: fileMode(info),
        };
      }
      return {
        kind: "unreadable",
        observation: "Unsupported filesystem entry.",
      };
    } catch (error) {
      if (error instanceof TypeError) {
        throw error;
      }
      if (isNotFound(error)) {
        return { kind: "absent" };
      }
      return { kind: "unreadable", observation: errorMessage(error) };
    }
  }

  async exists(path: RepositoryPath): Promise<boolean> {
    return (await this.observe(path)).kind !== "absent";
  }

  async readText(path: RepositoryPath): Promise<string | undefined> {
    const observation = await this.observe(path);
    return observation.kind === "file" ? observation.content : undefined;
  }

  async readJson(path: RepositoryPath): Promise<FileJson | undefined> {
    const observation = await this.observe(path);
    if (observation.kind !== "file") {
      return undefined;
    }
    return {
      value: JSON.parse(observation.content) as JsonValue,
      digest: observation.digest,
    };
  }

  async digest(path: RepositoryPath): Promise<FileDigest | undefined> {
    const observation = await this.observe(path);
    return observation.kind === "file" ? observation.digest : undefined;
  }

  async directoryStateDigest(
    path: RepositoryPath,
  ): Promise<DirectoryStateDigest | undefined> {
    const url = repositoryUrl(this.#root, path);
    await this.#assertContainedParent(url);
    let info: Stats;
    try {
      info = await fs.lstat(url);
    } catch (error) {
      if (isNotFound(error)) {
        return undefined;
      }
      throw error;
    }
    if (!info.isDirectory()) {
      return undefined;
    }
    return await digestDirectoryState(url);
  }

  async mode(path: RepositoryPath): Promise<FileMode | undefined> {
    const observation = await this.observe(path);
    return observation.kind === "file" ? observation.mode : undefined;
  }

  async #assertContainedParent(url: URL): Promise<void> {
    const relative = url.href.slice(this.#root.url.href.length);
    const parts = relative.split("/").filter(Boolean);
    let parent = this.#root.url;
    for (const part of parts.slice(0, -1)) {
      parent = new URL(
        `${encodeURIComponent(decodeURIComponent(part))}/`,
        parent,
      );
      try {
        if (
          (await fs.lstat(new URL(parent.href.slice(0, -1)))).isSymbolicLink()
        ) {
          throw new TypeError("Repository path traverses a symlink.");
        }
      } catch (error) {
        if (isNotFound(error)) {
          return;
        }
        throw error;
      }
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
