import { prepareTestDirectory } from "./testing/output.ts";
/** Required CI gate: every supported runtime executes the same complete inventory. */
import { fileURLToPath } from "node:url";
import { compareInventories } from "./testing/manifest.ts";
import { runDeno } from "./deno-process.ts";
const root = new URL("../", import.meta.url);
const tools = await prepareTestDirectory(root, "test-tools");
for (const file of ["package.json", "package-lock.json"]) {
  await Deno.copyFile(
    new URL(`test-build/tools/${file}`, import.meta.url),
    new URL(file, tools),
  );
}
const installed = await new Deno.Command("npm", {
  args: ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
  cwd: tools,
  stdout: "inherit",
  stderr: "inherit",
}).spawn().status;
if (!installed.success) {
  throw new Error("Frozen test runtime installation failed");
}
async function deno(args: string[]) {
  const code = await runDeno(args);
  if (code) {
    throw new Error(
      `Test matrix command failed (${code}): deno ${args.join(" ")}`,
    );
  }
}
const runner = fileURLToPath(new URL("scripts/run-tests.ts", root));
if (!Deno.args.includes("--reuse-deno")) {
  await deno(["run", "--allow-all", runner]);
}
await deno([
  "run",
  "--allow-all",
  fileURLToPath(new URL("scripts/build-tests.ts", root)),
]);
for (
  const [runtime, path, version] of [
    ["node", "node24/bin/node", "v24.21.0"],
    ["node", "node26/bin/node", "v26.2.0"],
    ["bun", "@oven/bun-linux-x64/bin/bun", "1.4.2"],
  ]
) {
  const executable = fileURLToPath(new URL(`node_modules/${path}`, tools));
  const output = await new Deno.Command(executable, { args: ["--version"] })
    .output();
  if (
    !output.success ||
    new TextDecoder().decode(output.stdout).trim() !== version
  ) throw new Error(`Unexpected test runtime version: ${path}`);
  await deno([
    "run",
    "--allow-all",
    runner,
    "--runtime",
    runtime,
    "--executable",
    executable,
  ]);
}
const reports = await Promise.all(
  ["deno", "node24", "node26", "bun"].map(async (label) =>
    JSON.parse(
      await Deno.readTextFile(new URL(`.hj/test-results/${label}.json`, root)),
    )
  ),
);
compareInventories(reports);
console.log(
  `All four runtimes executed the same ${
    reports[0].tests.length
  } test bodies from ${reports[0].files.length} files.`,
);
