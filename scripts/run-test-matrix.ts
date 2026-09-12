import { prepareTestDirectory } from "./testing/output.ts";
/** Required CI gate: every supported runtime executes the same complete inventory. */
import { fileURLToPath } from "node:url";
import { testFiles } from "./testing/manifest.ts";
import { matrixRuntimes, validateMatrixReports } from "./testing/matrix.ts";
import { runDeno } from "./deno-process.ts";
const root = new URL("../", import.meta.url);
const selection = Deno.args[0] === "--runtime" && Deno.args.length === 2
  ? Deno.args[1]
  : undefined;
const compareOnly = Deno.args.length === 1 && Deno.args[0] === "--compare-only";
if (
  selection
    ? !Object.hasOwn(matrixRuntimes, selection)
    : Deno.args.length && !compareOnly &&
      !(Deno.args.length === 1 && Deno.args[0] === "--reuse-deno")
) {
  throw new Error(
    "Use --runtime node24|node26|bun, --reuse-deno, or --compare-only",
  );
}
if (!compareOnly) {
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
  if (!selection && !Deno.args.includes("--reuse-deno")) {
    await deno(["run", "--allow-all", runner]);
  }
  await deno([
    "run",
    "--allow-all",
    fileURLToPath(new URL("scripts/build-tests.ts", root)),
  ]);
  for (
    const [label, { runtime, path, version }] of Object.entries(matrixRuntimes)
  ) {
    if (selection && label !== selection) continue;
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
}
if (!selection) {
  const reports = await Promise.all(
    ["deno", "node24", "node26", "bun"].map(async (label) =>
      JSON.parse(
        await Deno.readTextFile(
          new URL(`.hj/test-results/${label}.json`, root),
        ),
      )
    ),
  );
  validateMatrixReports(reports, await testFiles(root), Deno.version.deno);
  console.log(
    `All four runtimes executed the same ${
      reports[0].tests.length
    } test bodies from ${reports[0].files.length} files.`,
  );
}
