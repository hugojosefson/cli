import { readFile, writeFile } from "node:fs/promises";
import {
  nativeBuildInputs,
  nativePackageFiles,
} from "./native-build-inputs.ts";
import { nativeTree } from "./native-files.ts";
import { nativeGraph } from "./native-graph.ts";
import { digest, focusedGroups } from "./observation.ts";
import type { NativeBuildInputs, NativeReceipt } from "./native-types.ts";

export const nativeReceiptPath = ".hj/test/.hj-native-receipt.json";

export async function finishNativeBuild(
  root: URL,
  before: NativeBuildInputs,
  deno: string,
  path: string,
  buildMs: number,
  observationMs: number,
): Promise<void> {
  const started = performance.now();
  const after = await nativeBuildInputs(root, deno, path);
  if (digest(before) !== digest(after)) {
    throw new Error("Native build inputs changed during compilation");
  }
  const groups = Object.fromEntries(
    await Promise.all(
      focusedGroups.map(async (
        { name, files },
      ) => [name, await nativeGraph(root, files, deno)]),
    ),
  );
  const receipt: NativeReceipt = {
    schema: 1,
    source: digest(after.files),
    emitted: digest(await nativeTree(new URL(".hj/test/esm/", root))),
    dependencies: digest(
      await nativeTree(new URL(".hj/test/node_modules/", root)),
    ),
    packageFiles: digest(await nativePackageFiles(root)),
    inventory: after.inventory,
    tools: after.tools,
    groups,
    buildMs,
    observationMs: observationMs + performance.now() - started,
  };
  if (digest(after) !== digest(await nativeBuildInputs(root, deno, path))) {
    throw new Error("Native build inputs changed during inspection");
  }
  receipt.observationMs = observationMs + performance.now() - started;
  await writeFile(
    new URL(nativeReceiptPath, root),
    JSON.stringify(receipt) + "\n",
    { flag: "wx" },
  );
}

export async function readNativeReceipt(root: URL): Promise<NativeReceipt> {
  const receipt = JSON.parse(
    await readFile(new URL(nativeReceiptPath, root), "utf8"),
  );
  if (
    receipt.schema !== 1 || !Array.isArray(receipt.inventory) ||
    !receipt.groups || !receipt.tools
  ) {
    throw new Error("Native build receipt is not compatible");
  }
  return receipt;
}
