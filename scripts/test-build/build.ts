import { nativeBuildInputs } from "../testing/native-build-inputs.ts";
import { finishNativeBuild } from "../testing/native-build-receipt.ts";
import { prepareTestDirectory } from "../testing/output.ts";
/** Emit the full shared test graph without Deno registration or global shims. */
import { build } from "@deno/dnt";
import { fileURLToPath } from "node:url";
import { nativeBuildOptions } from "../npm-build/options.ts";
import { testFiles } from "../testing/manifest.ts";
const root = new URL("../../", import.meta.url);
const output = await prepareTestDirectory(root, "test", true);
const observationStarted = performance.now();
let nativeBefore;
try {
  nativeBefore = await nativeBuildInputs(
    root,
    Deno.execPath(),
    Deno.env.get("PATH") ?? "",
  );
} catch {
  console.warn("Native build observation is unavailable.");
}
const observationMs = performance.now() - observationStarted;
const buildStarted = performance.now();
for (const file of ["package.json", "package-lock.json", ".npmrc"]) {
  await Deno.copyFile(
    new URL(`dependencies/${file}`, import.meta.url),
    new URL(file, output),
  );
}
const result = await new Deno.Command("npm", {
  args: ["ci", "--ignore-scripts"],
  cwd: output,
  stdout: "inherit",
  stderr: "inherit",
}).spawn().status;
if (!result.success) {
  throw new Error(
    `Frozen test dependency installation failed (${result.code})`,
  );
}
const manifest = JSON.parse(
  await Deno.readTextFile(
    new URL("dependencies/package.json", import.meta.url),
  ),
);
const options = nativeBuildOptions(root, output, {
  name: "hj-shared-tests",
  version: "0.0.0",
  private: true,
  type: "module",
});
await build({
  ...options,
  entryPoints: [
    ...options.entryPoints,
    ...(await testFiles(root)).map((file) => ({
      name: "./" + file.slice(0, -3),
      path: fileURLToPath(new URL(file, root)),
    })),
  ],
  mappings: {
    ...options.mappings,
    "jsr:@std/assert": {
      name: "@jsr/std__assert",
      version: manifest.dependencies["@jsr/std__assert"],
    },
  },
});

if (nativeBefore) {
  try {
    await finishNativeBuild(
      root,
      nativeBefore,
      Deno.execPath(),
      Deno.env.get("PATH") ?? "",
      performance.now() - buildStarted,
      observationMs,
    );
  } catch {
    console.warn("Native build observation is unavailable.");
  }
}
