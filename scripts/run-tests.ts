import { prepareTestDirectory } from "./testing/output.ts";
/** Run the same explicit suite in isolated runtime processes and record test bodies. */
import { fileURLToPath } from "node:url";
import { executedInventory, testFiles } from "./testing/manifest.ts";
import { captureInputs } from "./testing/observation-inputs.ts";
import {
  type InputSnapshot,
  observeValidation,
} from "./testing/observation.ts";
const root = new URL("../", import.meta.url);
const options = [...Deno.args];
const take = (name: string) => {
  const index = options.indexOf(name);
  if (index < 0) return undefined;
  const value = options[index + 1];
  if (!value) throw new Error(`Missing value for ${name}`);
  options.splice(index, 2);
  return value;
};
const runtime = take("--runtime") ?? "deno";
if (!["deno", "node", "bun"].includes(runtime)) {
  throw new Error(`Unknown test runtime: ${runtime}`);
}
const executable = take("--executable") ??
  (runtime === "deno" ? Deno.execPath() : runtime);
const coverage = options.includes("--coverage");
if (coverage) options.splice(options.indexOf("--coverage"), 1);
if (coverage && runtime !== "deno") {
  throw new Error("Use Deno for the shared source coverage baseline");
}
const filter = take("--filter");
const manifest = await testFiles(root);
const files = options.length
  ? manifest.filter((file) =>
    options.some((path) => file.startsWith(path.replace(/^\.\//, "")))
  )
  : manifest;
if (
  !files.length ||
  options.some((path) =>
    !files.some((file) => file.startsWith(path.replace(/^\.\//, "")))
  )
) throw new Error("Unrecognized test path");
const native = new URL(".hj/test/esm/", root);
if (runtime !== "deno") {
  await Deno.stat(new URL(files[0].replace(/\.ts$/, ".js"), native));
}
await Deno.mkdir("/tmp/opencode", { recursive: true });
const journal = await Deno.makeTempFile({
  dir: "/tmp/opencode",
  prefix: "hj-test-inventory-",
});
const env = Deno.env.toObject();
for (
  const name of [
    "LD_LIBRARY_PATH",
    "LD_PRELOAD",
    "DYLD_LIBRARY_PATH",
    "DYLD_INSERT_LIBRARIES",
  ]
) delete env[name];
env.HJ_TEST_INVENTORY = journal;
env.HJ_TEST_SOURCE_ROOT = root.href;
env.HJ_TEST_DENO = Deno.execPath();
const permissions = [
  "--allow-sys=uid,gid",
  "--allow-read=/tmp/opencode,deno.json,deno.lock",
  "--allow-write=/tmp/opencode",
  "--allow-run=git,deno,sh",
  "--allow-net=127.0.0.1",
  "--allow-env=HJ_TEST_INVENTORY,HJ_TEST_SOURCE_ROOT,HJ_TEST_DENO,PATH,NODE_V8_COVERAGE,NODE_CHANNEL_FD,NODE_UNIQUE_ID,WS_NO_BUFFER_UTIL,WS_NO_UTF_8_VALIDATE,TERM,CLI_WIDTH,ESBUILD_BINARY_PATH,ESBUILD_WORKER_THREADS,LOG_TOKENS,LOG_STREAM,GIT_AUTHOR_NAME,GIT_AUTHOR_EMAIL,GIT_COMMITTER_NAME,GIT_COMMITTER_EMAIL",
];
const paths = files.map((file) =>
  fileURLToPath(
    new URL(
      runtime === "deno" ? file : file.replace(/\.ts$/, ".js"),
      runtime === "deno" ? root : native,
    ),
  )
);
const commands = runtime === "bun"
  ? paths.map((
    path,
  ) => [
    "test",
    "--timeout=120000",
    ...(filter ? ["--test-name-pattern", filter] : []),
    path,
  ])
  : [
    runtime === "deno"
      ? [
        "test",
        "--frozen",
        ...permissions,
        ...(coverage
          ? ["--coverage=.coverage", "--clean", "--coverage-raw-data-only"]
          : []),
        ...(filter ? ["--filter", filter] : []),
        ...paths,
      ]
      : [
        "--test",
        "--test-concurrency=1",
        "--test-timeout=120000",
        ...(filter ? ["--test-name-pattern", filter] : []),
        ...paths,
      ],
  ];
const version = new TextDecoder().decode(
  (await new Deno.Command(executable, {
    args: ["--version"],
    env,
    clearEnv: true,
  }).output()).stdout,
).split("\n")[0];
const context = {
  runtime,
  version,
  deno: Deno.version.deno,
  platform: Deno.build.os,
  arch: Deno.build.arch,
  coverage,
  // Generated journal and checkout URLs are bookkeeping, not focused inputs.
  environment: Object.fromEntries(
    [
      ...new Set([
        ...permissions.find((permission) =>
          permission.startsWith("--allow-env=")
        )!
          .slice("--allow-env=".length).split(","),
        "TZ",
        "LANG",
        "LC_ALL",
        "FORCE_COLOR",
        "NO_COLOR",
        "NODE_DISABLE_COLORS",
      ]),
    ].filter((name) =>
      ![
        "HJ_TEST_INVENTORY",
        "HJ_TEST_SOURCE_ROOT",
        "HJ_TEST_DENO",
      ].includes(name)
    ).sort().map((name) => [name, env[name] ?? null]),
  ),
};
let before: InputSnapshot | undefined;
let observationError: string | undefined;
const observationStarted = performance.now();
if (!options.length && !filter) {
  try {
    before = await captureInputs(root, manifest, Deno.execPath(), context);
  } catch (error) {
    observationError = String(error);
  }
}
let observationMs = performance.now() - observationStarted;
let code = 0;
const suiteStarted = performance.now();
try {
  for (const args of commands) {
    const result = await new Deno.Command(executable, {
      args,
      cwd: root,
      env,
      clearEnv: true,
      stdin: "null",
      stdout: "inherit",
      stderr: "inherit",
    }).spawn().status;
    if (!result.success) code = result.code || 1;
  }
  const suiteWallMs = performance.now() - suiteStarted;
  const events = (await Deno.readTextFile(journal)).trim().split("\n").filter(
    Boolean,
  ).map((line) => JSON.parse(line));
  const inventory = executedInventory(events, !filter);
  if (!filter) {
    for (const file of files) {
      if (
        !inventory.some((id) => id.startsWith(file + " > "))
      ) throw new Error(`No test executed from ${file}`);
    }
  }
  const output = await prepareTestDirectory(root, "test-results");
  const label = runtime === "node"
    ? `node${version.match(/v(\d+)/)![1]}`
    : runtime;
  const report = {
    runtime,
    version,
    complete: !options.length && !filter,
    success: code === 0,
    files,
    tests: inventory,
  };
  let observation;
  if (before && report.success) {
    const started = performance.now();
    try {
      const after = await captureInputs(
        root,
        await testFiles(root),
        Deno.execPath(),
        context,
      );
      observation = observeValidation(
        report,
        events,
        before,
        after,
        suiteWallMs,
      );
    } catch (error) {
      observationError = String(error);
    }
    observationMs += performance.now() - started;
  }
  await Deno.writeTextFile(
    new URL(`${label}.json`, output),
    JSON.stringify(
      {
        ...report,
        ...(observation ? { observation, observationMs } : {}),
        ...(observationError ? { observationError } : {}),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `Executed ${inventory.length} normalized test bodies in ${files.length} files (${label}).`,
  );
  if (observation) {
    console.log(
      `Observation only: github-repository ${
        observation.groups[0].bodyMs.toFixed(1)
      } ms in top-level bodies; ` +
        `${suiteWallMs.toFixed(1)} ms full suite; ${
          observationMs.toFixed(1)
        } ms input observation; ` +
        `${
          observation.stableInputs ? "stable" : "changed during run"
        } inputs. No tests skipped.`,
    );
  }
  if (observationError) {
    console.warn(`Validation observation unavailable: ${observationError}`);
  }
} finally {
  await Deno.remove(journal);
}
Deno.exit(code);
