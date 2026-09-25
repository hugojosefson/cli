import { toFileUrl } from "@std/path";
import {
  makeTempDir,
  mkdir,
  remove,
  writeTextFile,
} from "../testing/files-test-fixtures.ts";
import { runRawCommand } from "../runtime/command.ts";
import type { FeatureRegistry } from "../features/feature-registry.ts";
import { builtInFeatureRegistry } from "../features/built-in-feature-registry.ts";
import type { FeatureOperationServices } from "./run-features.ts";
import { runFeatureOperation } from "./run-features.ts";
import { parseFeatures } from "./parse-features.ts";
export async function withOverwriteRepository(
  action: (root: URL) => Promise<void>,
) {
  await mkdir("/tmp/opencode", { recursive: true });
  const path = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-overwrite-",
  });
  const root = toFileUrl(`${path}/`);
  try {
    await action(root);
  } finally {
    await remove(root, { recursive: true, force: true });
  }
}
export async function put(root: URL, path: string, content: string) {
  await mkdir(new URL("./", new URL(path, root)), { recursive: true });
  await writeTextFile(new URL(path, root), content);
}
export async function overwriteGit(root: URL, args: readonly string[]) {
  const result = await runRawCommand("git", { args, cwd: root });
  if (!result.success) {
    throw new Error(
      `git ${args.join(" ")} failed: ${
        new TextDecoder().decode(result.stderr)
      }`,
    );
  }
  return new TextDecoder().decode(result.stdout).trim();
}
export function overwrite(
  root: URL,
  flags: readonly string[],
  services: FeatureOperationServices = {},
  registry: FeatureRegistry = builtInFeatureRegistry,
) {
  return runFeatureOperation(
    root,
    parseFeatures(
      ["repo", "features", "--overwrite", ...flags],
      registry,
    ),
    registry,
    undefined,
    {
      reportOverwrite: () => {},
      runFinalTask: () => Promise.resolve(undefined),
      ...services,
    },
  );
}
