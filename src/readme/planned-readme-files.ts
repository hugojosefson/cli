/** @module Read-only file projection and guarded README contribution writes. */
import { applyEdits, modify } from "jsonc-parser";
import type { ArtifactObservation } from "../api/artifact-inspection.ts";
import type { Precondition } from "../api/change-plan.ts";
import type { FileReader } from "../api/repository-context.ts";
import type { PlannedChange } from "../api/planned-change.ts";
import { blockHash } from "./contribution-blocks.ts";

export class PlannedReadmeFiles implements FileReader {
  readonly preconditions: Precondition[] = [];
  readonly changes: PlannedChange[] = [];
  readonly #observed = new Map<string, ArtifactObservation>();
  constructor(
    readonly files: FileReader,
    readonly preceding: readonly PlannedChange[],
  ) {}

  async observe(path: string): Promise<ArtifactObservation> {
    let value = this.#observed.get(path);
    if (!value) {
      value = await this.files.observe(path);
      this.#observed.set(path, value);
      if (value.kind === "file" || value.kind === "absent") {
        this.preconditions.push({
          kind: "file-digest",
          path,
          digest: value.kind === "file" ? value.digest : undefined,
        });
      }
    }
    for (const change of [...this.preceding, ...this.changes]) {
      if (!("path" in change)) continue;
      if (
        change.kind === "remove-directory" && path.startsWith(change.path + "/")
      ) value = { kind: "absent" };
      if (change.path !== path) continue;
      if (change.kind === "remove-file" || change.kind === "remove-directory") {
        value = { kind: "absent" };
      }
      if (change.kind === "create-directory") {
        value = { kind: "directory", stateDigest: "projected" };
      }
      if (change.kind === "set-file-mode" && value.kind === "file") {
        value = { ...value, mode: change.mode };
      }
      if (change.kind === "write-file") {
        value = {
          kind: "file",
          content: change.content,
          digest: await blockHash(change.content),
          mode: change.mode ?? (value.kind === "file" ? value.mode : 0o644),
        };
      }
      if (
        (change.kind === "set-json" || change.kind === "remove-json") &&
        value.kind === "file"
      ) {
        const content = applyEdits(
          value.content,
          modify(
            value.content,
            [...change.jsonPath],
            change.kind === "set-json" ? change.value : undefined,
            {},
          ),
        );
        value = { ...value, content, digest: await blockHash(content) };
      }
    }
    return value;
  }
  async read(path: string): Promise<string | undefined> {
    const value = await this.observe(path);
    if (value.kind !== "absent" && value.kind !== "file") {
      throw new Error(`README contribution needs a regular file: ${path}`);
    }
    return value.kind === "file" ? value.content : undefined;
  }
  readText(path: string): Promise<string | undefined> {
    return this.read(path);
  }
  async exists(path: string): Promise<boolean> {
    return (await this.observe(path)).kind !== "absent";
  }
  async readJson(path: string) {
    const value = await this.observe(path);
    return value.kind === "file"
      ? { value: JSON.parse(value.content), digest: value.digest }
      : undefined;
  }
  async digest(path: string) {
    const value = await this.observe(path);
    return value.kind === "file" ? value.digest : undefined;
  }
  async directoryStateDigest(path: string) {
    const value = await this.observe(path);
    return value.kind === "directory" ? value.stateDigest : undefined;
  }
  async mode(path: string) {
    const value = await this.observe(path);
    return value.kind === "file" ? value.mode : undefined;
  }
  async write(
    path: string,
    content: string | undefined,
    mode?: number,
  ): Promise<void> {
    const value = await this.observe(path);
    if (value.kind !== "absent" && value.kind !== "file") {
      throw new Error(`README contribution needs a regular file: ${path}`);
    }
    if (value.kind === "file" && value.content === content) return;
    if (content === undefined) {
      if (value.kind === "file") {
        this.changes.push({
          kind: "remove-file",
          path,
          expectedDigest: value.digest,
        });
      }
      return;
    }
    const parent = path.includes("/")
      ? path.slice(0, path.lastIndexOf("/"))
      : undefined;
    if (parent) {
      const directory = await this.observe(parent);
      if (directory.kind === "absent") {
        this.changes.push({ kind: "create-directory", path: parent });
      } else if (directory.kind !== "directory") {
        throw new Error(
          `README contribution parent is not a directory: ${parent}`,
        );
      }
    }
    const locked = value.kind === "file" && !(value.mode & 0o200);
    if (locked) {
      this.changes.push({
        kind: "set-file-mode",
        path,
        mode: 0o644,
        expectedMode: value.mode,
      });
    }
    this.changes.push({
      kind: "write-file",
      path,
      content,
      expectedDigest: value.kind === "file" ? value.digest : undefined,
      mode: mode ?? (value.kind === "file" ? value.mode : 0o644),
    });
    if (
      value.kind === "file" &&
      (locked || mode !== undefined && mode !== value.mode)
    ) {
      this.changes.push({
        kind: "set-file-mode",
        path,
        mode: mode ?? value.mode,
        expectedMode: locked ? 0o644 : value.mode,
      });
    }
  }
}
