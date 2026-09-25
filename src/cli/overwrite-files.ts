/** @module In-memory local artifacts for overwrite planning. */
import * as fs from "node:fs/promises";
import { isNotFound } from "../runtime/errors.ts";
import { applyEdits, modify } from "jsonc-parser";
import type { ArtifactObservation } from "../api/artifact-inspection.ts";
import type { FileReader } from "../api/repository-context.ts";
import type { PlannedChange } from "../api/planned-change.ts";
import { LocalFileReader } from "../repository/local-file-reader.ts";
import { digestBytes } from "../repository/digest-bytes.ts";
import {
  repositoryRoot,
  repositoryUrl,
} from "../repository/repository-path.ts";
import { sameArtifact } from "./overwrite-artifact-state.ts";
import { compileOverwriteChanges } from "./overwrite-changes.ts";

export class OverwriteFiles implements FileReader {
  readonly original = new Map<string, ArtifactObservation>();
  readonly changed = new Map<string, ArtifactObservation>();
  readonly #reader: LocalFileReader;
  readonly #root: ReturnType<typeof repositoryRoot>;

  constructor(root: URL) {
    this.#reader = new LocalFileReader(root);
    this.#root = repositoryRoot(root);
  }

  async observe(path: string): Promise<ArtifactObservation> {
    this.#checkPath(path);
    if (this.changed.has(path)) return this.changed.get(path)!;
    for (const parent of parents(path)) {
      const state = this.changed.get(parent);
      if (state && state.kind !== "directory") return { kind: "absent" };
      if (state && this.original.get(parent)?.kind !== "directory") {
        return { kind: "absent" };
      }
    }
    return await this.initial(path);
  }

  async initial(path: string): Promise<ArtifactObservation> {
    this.#checkPath(path);
    if (this.original.has(path)) return this.original.get(path)!;
    for (const parent of parents(path)) {
      if ((await this.initial(parent)).kind !== "directory") {
        const absent = { kind: "absent" as const };
        this.original.set(path, absent);
        return absent;
      }
    }
    const state = await this.#observeInitial(path);
    this.original.set(path, state);
    return state;
  }

  async #observeInitial(path: string): Promise<ArtifactObservation> {
    try {
      const url = repositoryUrl(this.#root, path);
      const info = await fs.lstat(url);
      if (info.isDirectory()) {
        return { kind: "directory", stateDigest: "directory" };
      }
      return await this.#reader.observe(path);
    } catch (error) {
      if (isNotFound(error)) return { kind: "absent" };
      throw error;
    }
  }

  async remove(path: string): Promise<void> {
    await this.initial(path);
    this.changed.set(path, { kind: "absent" });
  }

  async write(path: string, content: string, mode = 0o644): Promise<void> {
    await this.initial(path);
    await this.directoryParents(path);
    this.changed.set(path, {
      kind: "file",
      content,
      mode,
      digest: await digestBytes(new TextEncoder().encode(content)),
    });
  }

  async clearParents(path: string): Promise<void> {
    for (const parent of parents(path)) {
      const state = await this.observe(parent);
      if (state.kind !== "directory" && state.kind !== "absent") {
        await this.remove(parent);
      }
    }
  }

  async directoryParents(path: string): Promise<void> {
    for (const parent of parents(path)) {
      if ((await this.observe(parent)).kind !== "directory") {
        await this.initial(parent);
        this.changed.set(parent, { kind: "directory", stateDigest: "virtual" });
      }
    }
  }

  async apply(change: PlannedChange): Promise<void> {
    if (!("path" in change)) {
      throw new Error(`--overwrite cannot apply ${change.kind}.`);
    }
    const path = change.path;
    if (change.kind === "write-file") {
      const current = await this.observe(path);
      await this.write(
        path,
        change.content,
        change.mode ?? (current.kind === "file" ? current.mode : 0o644),
      );
    } else if (change.kind === "set-json" || change.kind === "remove-json") {
      const current = await this.observe(path);
      if (current.kind !== "file") {
        throw new Error(`Expected a JSON file: ${path}`);
      }
      const content = applyEdits(
        current.content,
        modify(
          current.content,
          [...change.jsonPath],
          change.kind === "set-json" ? change.value : undefined,
          { formattingOptions: { insertSpaces: true, tabSize: 2 } },
        ),
      );
      await this.write(path, content, current.mode);
    } else if (change.kind === "set-file-mode") {
      const current = await this.observe(path);
      if (current.kind !== "file") {
        throw new Error(`Expected a regular file: ${path}`);
      }
      await this.write(path, current.content, change.mode);
    } else if (change.kind === "create-directory") {
      await this.directoryParents(`${path}/child`);
    } else if (change.kind.startsWith("remove-")) {
      await this.remove(path);
    } else {
      throw new Error(`--overwrite cannot apply ${change.kind}.`);
    }
  }

  changes(): Promise<readonly PlannedChange[]> {
    return compileOverwriteChanges(this.#root, this);
  }

  async verify(): Promise<void> {
    const fresh = new OverwriteFiles(this.#root.url);
    for (const [path, observed] of this.original) {
      if (!sameArtifact(observed, await fresh.initial(path))) {
        throw new Error(`Repository artifact changed after planning: ${path}`);
      }
    }
  }

  async exists(path: string) {
    return (await this.observe(path)).kind !== "absent";
  }
  async readText(path: string) {
    const state = await this.observe(path);
    return state.kind === "file" ? state.content : undefined;
  }
  async readJson(path: string) {
    const state = await this.observe(path);
    return state.kind === "file"
      ? { value: JSON.parse(state.content), digest: state.digest }
      : undefined;
  }
  async digest(path: string) {
    const state = await this.observe(path);
    return state.kind === "file" ? state.digest : undefined;
  }
  async mode(path: string) {
    const state = await this.observe(path);
    return state.kind === "file" ? state.mode : undefined;
  }
  async directoryStateDigest(path: string) {
    const state = await this.observe(path);
    return state.kind === "directory" ? state.stateDigest : undefined;
  }

  #checkPath(path: string): void {
    repositoryUrl(this.#root, path);
    if (path.split("/").some((part) => part.toLowerCase() === ".git")) {
      throw new Error("--overwrite cannot change Git metadata.");
    }
  }
}

function parents(path: string): string[] {
  const parts = path.split("/");
  return parts.slice(0, -1).map((_, index) =>
    parts.slice(0, index + 1).join("/")
  );
}
