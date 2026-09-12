import { nativeEnvironment } from "./testing/native-environment.ts";
import { nativeCommandPlan } from "./testing/native-command-plan.ts";
import { captureNativeInputs } from "./testing/native-observation.ts";
import type {
  NativeObservation,
  NativeSnapshot,
} from "./testing/native-types.ts";
import { nativeResult } from "./testing/native-result.ts";
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
  "--allow-sys=uid,gid,osRelease",
  `--allow-read=/tmp/opencode,deno.json,deno.lock,${Deno.execPath()}`,
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
const commands = runtime === "deno"
  ? [{
    focused: false,
    args: [
      "test",
      "--frozen",
      ...permissions,
      ...(coverage
        ? ["--coverage=.coverage", "--clean", "--coverage-raw-data-only"]
        : []),
      ...(filter ? ["--filter", filter] : []),
      ...paths,
    ],
  }]
  : nativeCommandPlan(runtime, files, native, filter);
let focusedEnvironment: Record<string, string> | undefined;
let nativeError: string | undefined;
let nativeTemporary: string | undefined;
if (runtime !== "deno") {
  try {
    nativeTemporary = await Deno.makeTempDir({
      dir: "/tmp/opencode",
      prefix: "hj-native-environment-",
    });
    await Deno.mkdir(nativeTemporary + "/home");
    await Deno.mkdir(nativeTemporary + "/tmp");
    focusedEnvironment = {
      ...await nativeEnvironment(Deno.execPath(), env.PATH ?? ""),
      HOME: nativeTemporary + "/home",
      TMPDIR: nativeTemporary + "/tmp",
    };
  } catch {
    nativeError = "Native environment is unavailable";
  }
}
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
let nativeBefore: NativeSnapshot | undefined;
let nativeObservationMs = 0;
if (!options.length && !filter && focusedEnvironment) {
  const started = performance.now();
  try {
    nativeBefore = await captureNativeInputs(
      root,
      runtime,
      executable,
      focusedEnvironment,
    );
  } catch {
    nativeError = "Native inputs are unavailable; rebuild the native tests";
  }
  nativeObservationMs += performance.now() - started;
}
let code = 0;
const suiteStarted = performance.now();
try {
  for (const command of commands) {
    const result = await new Deno.Command(executable, {
      args: command.args,
      cwd: root,
      env: command.focused && focusedEnvironment
        ? {
          ...focusedEnvironment,
          HJ_TEST_INVENTORY: journal,
          HJ_TEST_SOURCE_ROOT: root.href,
        }
        : env,
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
  let nativeObservation: NativeObservation | undefined;
  if (nativeBefore && report.complete && report.success && focusedEnvironment) {
    const started = performance.now();
    try {
      const after = await captureNativeInputs(
        root,
        runtime,
        executable,
        focusedEnvironment,
      );
      nativeObservationMs += performance.now() - started;
      nativeObservation = nativeResult(
        report,
        nativeBefore,
        after,
        nativeObservationMs,
      );
    } catch {
      nativeObservationMs += performance.now() - started;
      nativeError = "Native inputs changed or are unavailable";
    }
  }
  await Deno.writeTextFile(
    new URL(`${label}.json`, output),
    JSON.stringify(
      {
        ...report,
        ...(nativeObservation ? { nativeObservation } : {}),
        ...(nativeError
          ? { nativeObservationError: nativeError, nativeObservationMs }
          : {}),
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
      `Observation only: ${
        observation.groups.filter((group) => group.name !== "remainder").map((
          group,
        ) => `${group.name} ${group.bodyMs.toFixed(1)} ms`).join(", ")
      } in top-level bodies; ` +
        `${suiteWallMs.toFixed(1)} ms full suite; ${
          observationMs.toFixed(1)
        } ms input observation; ` +
        `${
          observation.stableInputs ? "stable" : "changed during run"
        } inputs. No tests skipped.`,
    );
  }
  if (nativeObservation) {
    const snapshot = nativeObservation.snapshot;
    console.log(`Native input summary: ${
      JSON.stringify({
        runtime: label,
        cacheEligible: false,
        context: snapshot.context,
        groups: Object.fromEntries(
          Object.entries(snapshot.groups).map(([name, group]) => [name, {
            key: group.key,
            inputs: Object.fromEntries(
              ["configuration", "packages", "dependencies", "tools"].map((
                input,
              ) => [
                input,
                group.inputs[input],
              ]),
            ),
          }]),
        ),
        buildMs: snapshot.buildMs,
        buildObservationMs: snapshot.buildObservationMs,
        observationMs: nativeObservation.observationMs,
      })
    }`);
    console.log(
      `Native input observation: ${
        nativeObservationMs.toFixed(1)
      } ms. Cache restoration is disabled.`,
    );
  }
  if (nativeError) console.warn(nativeError);
  if (observationError) {
    console.warn(`Validation observation unavailable: ${observationError}`);
  }
} finally {
  await Deno.remove(journal);
  if (nativeTemporary) await Deno.remove(nativeTemporary, { recursive: true });
}
Deno.exit(code);
