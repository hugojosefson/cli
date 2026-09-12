import { arch, endianness, platform, release } from "node:os";
import { readFile } from "node:fs/promises";
import { nativePackageFiles, nativeSources } from "./native-build-inputs.ts";
import { readNativeReceipt } from "./native-build-receipt.ts";
import { nativeTree } from "./native-files.ts";
import { nativeTools } from "./native-tools.ts";
import { testFiles } from "./manifest.ts";
import { digest, focusedGroups } from "./observation.ts";
import type { NativeSnapshot } from "./native-types.ts";

export async function captureNativeInputs(
  root: URL,
  runtime: string,
  executable: string,
  environment: Record<string, string>,
): Promise<NativeSnapshot> {
  const receipt = await readNativeReceipt(root);
  const source = await nativeSources(root);
  const inventory = await testFiles(root);
  const emitted = await nativeTree(new URL(".hj/test/esm/", root));
  const dependencies = await nativeTree(
    new URL(".hj/test/node_modules/", root),
  );
  const packages = await nativePackageFiles(root);
  if (
    receipt.source !== digest(source) || receipt.emitted !== digest(emitted) ||
    receipt.dependencies !== digest(dependencies) ||
    receipt.packageFiles !== digest(packages) ||
    digest(receipt.inventory) !== digest(inventory)
  ) {
    throw new Error("Native build receipt does not agree with current inputs");
  }
  const tools = await nativeTools({
    runtime: executable,
    deno: environment.HJ_TEST_DENO,
    git: "git",
  }, environment.PATH);
  const context = digest({
    runtime,
    tools,
    environment: {
      ...environment,
      HOME: "empty-owned-home",
      TMPDIR: "owned-temporary-directory",
    },
    platform: {
      os: platform(),
      arch: arch(),
      release: release(),
      endianness: endianness(),
    },
    policy: "native-focused-environment-v1",
    command: runtime === "node"
      ? ["--test", "--test-concurrency=1", "--test-timeout=120000"]
      : ["test", "--timeout=120000"],
  });
  const config = JSON.parse(await readFile(new URL("deno.json", root), "utf8"));
  delete config.version;
  const common: Record<string, string> = {
    configuration: digest({ config, mode: source["deno.json"].mode }),
    packages: digest(packages),
    dependencies: digest(dependencies),
    tools: digest(receipt.tools),
    context,
  };
  for (const [path, value] of Object.entries(source)) {
    if (
      path.startsWith("scripts/") ||
      ["deno.lock", "toolchain.json"].includes(path)
    ) common[path] = digest(value);
  }
  const groups = Object.fromEntries(focusedGroups.map(({ name, files }) => {
    const graph = receipt.groups[name];
    if (
      !graph ||
      !files.every((file) => graph.files.includes(file.replace(/\.ts$/, ".js")))
    ) {
      throw new Error("Native receipt lacks focused entrypoints");
    }
    const inputs: Record<string, string> = {
      ...common,
      graph: digest(graph),
      files: digest(files),
    };
    for (const path of graph.files) {
      if (!emitted[path]) {
        throw new Error("Native receipt import is missing");
      }
      inputs["emitted:" + path] = digest(emitted[path]);
      const original = path.replace(/\.js$/, ".ts");
      if (source[original]) {
        inputs[original] = digest(source[original]);
      }
    }
    return [name, { key: digest(inputs), inputs }];
  }));
  return {
    schema: 1,
    inventory,
    groups,
    context,
    receipt: digest(receipt),
    dependencyFiles: Object.keys(dependencies).length,
    dependencyBytes: Object.values(dependencies).reduce(
      (sum, file) => sum + file.bytes,
      0,
    ),
    buildMs: receipt.buildMs,
    buildObservationMs: receipt.observationMs,
  };
}
