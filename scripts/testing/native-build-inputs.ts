import { nativeFile, nativeTree } from "./native-files.ts";
import { testFiles } from "./manifest.ts";
import type { NativeBuildInputs, NativeFiles } from "./native-types.ts";
import { nativeTools } from "./native-tools.ts";

export async function nativeSources(root: URL): Promise<NativeFiles> {
  const files: NativeFiles = {};
  for (const directory of ["src", "scripts"]) {
    for (
      const [name, value] of Object.entries(
        await nativeTree(new URL(directory + "/", root)),
      )
    ) {
      files[directory + "/" + name] = value;
    }
  }
  for (const name of ["deno.json", "deno.lock", "toolchain.json"]) {
    files[name] = await nativeFile(new URL(name, root));
  }
  return files;
}

export async function nativeBuildInputs(
  root: URL,
  deno: string,
  path: string,
): Promise<NativeBuildInputs> {
  const tools = await nativeTools({ deno, node: "node", npm: "npm" }, path);
  return {
    files: await nativeSources(root),
    inventory: await testFiles(root),
    tools,
  };
}

export async function nativePackageFiles(root: URL): Promise<NativeFiles> {
  const files: NativeFiles = {};
  for (const name of ["package.json", "package-lock.json"]) {
    files[name] = await nativeFile(new URL(".hj/test/" + name, root));
  }
  return files;
}
