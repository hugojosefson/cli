/** @module Automatic Git commit planning for local feature operations. */
import { runCommand } from "../runtime/command.ts";
import { makeTempDirectory } from "../runtime/temp.ts";
import * as fs from "node:fs/promises";

import type { ChangePlan } from "../api/change-plan.ts";
import { repositoryRoot } from "../repository/repository-path.ts";

/** Returns sorted unique repository paths changed by local file operations. */
export function plannedCommitPaths(
  plans: readonly ChangePlan[],
): readonly string[] {
  const paths = plans.flatMap((plan) => plan.changes).flatMap((change) => {
    if (
      change.kind === "write-file" || change.kind === "create-symlink" ||
      change.kind === "remove-symlink" || change.kind === "remove-file" ||
      change.kind === "remove-directory" || change.kind === "set-file-mode" ||
      change.kind === "set-json" || change.kind === "remove-json"
    ) {
      return [change.path];
    }
    return [];
  });
  return [...new Set(paths)].sort();
}

/** Git can resolve both commit identities before a repository exists. */
export async function requireGitIdentity(root: URL): Promise<void> {
  for (const role of ["AUTHOR", "COMMITTER"] as const) {
    const result = await runCommand("git", {
      args: ["var", `GIT_${role}_IDENT`],
      cwd: repositoryRoot(root).path,
    });
    if (!result.success) {
      throw new Error(
        `Git ${role.toLowerCase()} identity is required.\n` +
          "Set the commit identity, then retry:\n" +
          '  git config --global user.name "Your Name"\n' +
          '  git config --global user.email "you@example.com"\n' +
          "No changes were made.",
      );
    }
  }
}

import {
  changedFiles,
  type FileSnapshot,
  type FileVersion,
  sameFile,
  snapshotFiles,
} from "./feature-file-snapshot.ts";
import { LocalGitReader } from "../repository/local-git-reader.ts";
import { partitionFeatureConfig } from "./partition-feature-config.ts";
import { partitionFeatureReadme } from "./partition-feature-readme.ts";
import { partitionReadmeContributions } from "./partition-readme-contributions.ts";

interface FeatureSnapshot {
  readonly plan: ChangePlan;
  readonly files: Map<string, FileVersion | undefined>;
}

/** Defers all feature commits until final task execution and validation succeed. */
export class FeatureCommitSession {
  #previous: FileSnapshot;
  readonly #features: FeatureSnapshot[] = [];
  #head: string | undefined;
  #initialized = false;
  readonly #baseline: FileSnapshot;

  private constructor(
    readonly root: URL,
    readonly plans: readonly ChangePlan[],
    baseline: FileSnapshot,
    head?: string,
  ) {
    this.#previous = new Map(baseline);
    this.#baseline = baseline;
    this.#head = head;
  }

  /** Resolves identity and protects existing edits before any operation writes. */
  static async prepare(
    root: URL,
    plans: readonly ChangePlan[],
  ): Promise<FeatureCommitSession | undefined> {
    const reader = new LocalGitReader(root);
    const exists = await reader.isRepository();
    const initializes = plans.some((plan) =>
      plan.changes.some((change) => change.kind === "git-init")
    );
    const paths = plannedCommitPaths(plans);
    if (!initializes && (!exists || paths.length === 0)) return undefined;
    await requireGitIdentity(root);
    const head = (await reader.head())?.commit;
    if (head && paths.length) {
      const dirty =
        (await reader.status(paths, { includeIgnored: true }))?.changedPaths ??
          [];
      if (dirty.length) {
        throw new Error(
          `Feature commits would include existing edits: ${
            dirty.join(", ")
          }. Commit or move these edits before retrying. No changes were made.`,
        );
      }
    }
    return new FeatureCommitSession(
      root,
      plans,
      await snapshotFiles(root, paths),
      head,
    );
  }

  /** Makes an empty base once Git exists, preserving the user's staged files. */
  async initialize(): Promise<void> {
    if (this.#head || !await new LocalGitReader(this.root).isRepository()) {
      return;
    }
    this.#head = (await new LocalGitReader(this.root).head())?.commit;
    if (this.#head) return;
    const tree = await this.#git(["mktree"], new Uint8Array());
    const commit = await this.#git([
      "commit-tree",
      tree,
      "-m",
      "chore: init repo",
    ]);
    await this.#git(["update-ref", "HEAD", commit, "0".repeat(commit.length)]);
    this.#head = commit;
    this.#initialized = true;
  }

  /** Records each feature's actual edits while shared files are still separable. */
  async capture(
    plan: ChangePlan,
    onlyPaths?: readonly string[],
  ): Promise<void> {
    const current = await snapshotFiles(this.root, [
      ...this.#previous.keys(),
      ...plannedCommitPaths(this.plans),
    ]);
    const paths = changedFiles(this.#previous, current).filter((path) =>
      !onlyPaths || onlyPaths.includes(path)
    );
    if (paths.length) {
      let feature = this.#features.find((item) =>
        item.plan.featureId === plan.featureId
      );
      if (!feature) {
        feature = { plan, files: new Map() };
        this.#features.push(feature);
      }
      for (const path of paths) feature.files.set(path, current.get(path));
    }
    if (onlyPaths) {
      for (const path of paths) {
        const file = current.get(path);
        if (file) this.#previous.set(path, file);
        else this.#previous.delete(path);
      }
    } else this.#previous = current;
  }

  /** Builds a commit chain in a private index, then publishes the chain at once. */
  async finish(): Promise<boolean> {
    if (!this.#head) return false;
    const final = await snapshotFiles(this.root, [
      ...this.#previous.keys(),
      ...plannedCommitPaths(this.plans),
    ]);
    await partitionFeatureConfig(
      this.plans,
      this.#baseline,
      this.#features,
      final,
    );
    partitionReadmeContributions(this.#baseline, this.#features, final);
    partitionFeatureReadme(this.#baseline, this.#features);
    await this.#attributeTaskChanges(final);
    const replayed = new Map<string, FileVersion | undefined>();
    for (const feature of this.#features) {
      for (const [path, file] of feature.files) replayed.set(path, file);
    }
    for (const [path, file] of replayed) {
      if (!sameFile(file, final.get(path))) {
        throw new Error(
          `Feature history does not match validated ${path}; no feature commits were created.`,
        );
      }
    }
    const directory = await makeTempDirectory({
      dir: await this.#git(["rev-parse", "--absolute-git-dir"]),
      prefix: "hj-feature-index-",
    });
    const env = { GIT_INDEX_FILE: `${directory}/index` };
    try {
      let head = this.#head;
      await this.#git(["read-tree", head], undefined, env);
      const committedPaths = new Set<string>();
      for (const feature of this.#features) {
        for (const [path, file] of feature.files) {
          await this.#stage(path, file, env);
          committedPaths.add(path);
        }
        const tree = await this.#git(["write-tree"], undefined, env);
        const previousTree = await this.#git(["rev-parse", `${head}^{tree}`]);
        if (tree === previousTree) continue;
        const action = feature.plan.action === "disable" ? "disable" : "enable";
        head = await this.#git([
          "commit-tree",
          tree,
          "-p",
          head,
          "-m",
          `chore(${feature.plan.featureId}): ${action} feature`,
        ]);
      }
      if (head === this.#head) return this.#initialized;
      // Task or external processes must not change files while their commits build.
      const latest = await snapshotFiles(this.root, [
        ...this.#previous.keys(),
        ...plannedCommitPaths(this.plans),
      ]);
      if (changedFiles(final, latest).length) {
        throw new Error(
          "Project files changed after validation; no feature commits were created.",
        );
      }
      await this.#git(["update-ref", "HEAD", head, this.#head]);
      // Change only owned index entries. Unrelated staged additions and edits survive.
      for (const path of committedPaths) {
        await this.#stage(path, final.get(path));
      }
      return true;
    } finally {
      await fs.rm(directory, { recursive: true });
    }
  }

  async #attributeTaskChanges(final: FileSnapshot): Promise<void> {
    for (const path of changedFiles(this.#previous, final)) {
      if (!this.#baseline.has(path) && this.#coverageOutput(path, final)) {
        continue;
      }
      const owners = this.#features.filter((feature) =>
        feature.files.has(path)
      );
      const output = final.get(path);
      if (owners.length === 1) {
        owners[0].files.set(path, output);
        continue;
      }
      if (
        owners.length > 1 && output &&
        await this.#formattedSharedFile(path, owners, output)
      ) continue;
      const lockOwner = (path === "deno.lock" || path === ".hj/deno-lock.json")
        ? this.#features.find((feature) =>
          feature.files.has(".hj/deno-lock.json")
        )
        : undefined;
      if (lockOwner) {
        lockOwner.files.set(path, output);
        continue;
      }
      throw new Error(
        `Final task changed ${path}, but its changes cannot be attributed to one feature. No feature commits were created; files remain available for correction.`,
      );
    }
  }

  #coverageOutput(path: string, final: FileSnapshot): boolean {
    const config = final.get("deno.json") ?? final.get("deno.jsonc");
    if (!config) return false;
    const text = new TextDecoder().decode(config.bytes);
    for (const match of text.matchAll(/--coverage(?:=| +)([\w./-]+)/g)) {
      const directory = match[1].replace(/^\.\//, "").replace(/\/$/, "");
      if (directory && path.startsWith(`${directory}/`)) return true;
    }
    return false;
  }

  async #formattedSharedFile(
    path: string,
    owners: FeatureSnapshot[],
    output: FileVersion,
  ): Promise<boolean> {
    const extension = path.split(".").at(-1);
    if (
      !extension ||
      !["json", "jsonc", "md", "ts", "js", "tsx", "jsx", "yaml", "yml"]
        .includes(extension)
    ) return false;
    const formatted: (FileVersion | undefined)[] = [];
    for (const owner of owners) {
      const file = owner.files.get(path);
      if (!file || file.mode === "120000") return false;
      const result = await runCommand("deno", {
        args: ["fmt", "--quiet", `--ext=${extension}`, "-"],
        cwd: this.root,
        input: file.bytes,
        stdout: "piped",
        stderr: "piped",
      });

      if (!result.success) return false;
      formatted.push({ ...file, bytes: result.stdout });
    }
    if (!sameFile(formatted.at(-1), output)) return false;
    for (let index = 0; index < owners.length; index++) {
      owners[index].files.set(path, formatted[index]);
    }
    return true;
  }

  async #stage(
    path: string,
    file: FileVersion | undefined,
    env?: Record<string, string>,
  ): Promise<void> {
    if (!file) {
      await this.#git(
        ["update-index", "--force-remove", "--", path],
        undefined,
        env,
      );
      return;
    }
    const blob = await this.#git(["hash-object", "-w", "--stdin"], file.bytes);
    await this.#git(
      ["update-index", "--add", "--cacheinfo", file.mode, blob, path],
      undefined,
      env,
    );
  }

  async #git(
    args: string[],
    input?: Uint8Array,
    env?: Record<string, string>,
  ): Promise<string> {
    const result = await runCommand("git", {
      args,
      cwd: this.root,
      env,
      input: input ?? new Uint8Array(),
      stdout: "piped",
      stderr: "piped",
    });

    if (!result.success) {
      throw new Error(
        `Git ${args[0]} failed while preparing feature commits: ${
          new TextDecoder().decode(result.stderr).trim()
        }`,
      );
    }
    return new TextDecoder().decode(result.stdout).trim();
  }
}
