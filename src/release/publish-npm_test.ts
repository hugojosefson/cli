import { runRawCommand as runCommand } from "../runtime/command.ts";
import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import {
  makeTempDir,
  mkdir,
  remove,
  writeTextFile,
} from "../testing/files-test-fixtures.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import {
  environment,
  files,
  ok,
  process,
  sha,
} from "./publisher-test-fixtures.ts";
import {
  localNpmBuildFiles,
  npmHttpApi,
  type NpmVersion,
  publishNpm,
} from "./publish-npm.ts";

const integrity = "sha512-" + "a".repeat(86) + "==";
const manifest = {
  name: "@owner/repo",
  version: "1.2.3",
  gitHead: sha,
  bin: { repo: "bin/cli.js" },
};
const expected: NpmVersion = {
  name: manifest.name,
  version: manifest.version,
  gitHead: sha,
  integrity,
};
function fixture() {
  const calls: string[] = [];
  const commands = process(calls);
  let remote: NpmVersion | undefined;
  let publishFails = false;
  let confirms = true;
  let packFiles = ["package.json", "bin/cli.js"];
  let data = { ...manifest };
  const input = {
    root: new URL("file:///repo/"),
    environment: environment(),
    files: files(
      JSON.stringify({
        ...manifest,
        tasks: { "npm-build": "deno run build.ts" },
      }),
    ),
    buildFiles: {
      read: (path: string) =>
        Promise.resolve(
          path === "package.json"
            ? JSON.stringify(data)
            : "#!/usr/bin/env node\n",
        ),
    },
    process: {
      async run(command: string, args: readonly string[]) {
        if (command !== "npm") return await commands.run(command, args);
        calls.push(`${command} ${args.join(" ")}`);
        if (args[0] === "pack") {
          return ok(
            JSON.stringify([{
              name: manifest.name,
              version: manifest.version,
              filename: "owner-repo-1.2.3.tgz",
              integrity,
              files: packFiles.map((path) => ({ path })),
            }]),
          );
        }
        if (confirms) remote = { ...expected };
        return publishFails ? { ...ok(), success: false, code: 1 } : ok();
      },
    },
    api: { version: () => Promise.resolve(remote) },
    clock: { sleep: () => Promise.resolve() },
  };
  return {
    input,
    calls,
    existing: (value: NpmVersion) => remote = value,
    mutate: (value: Partial<typeof manifest>) => data = { ...data, ...value },
    fail: () => publishFails = true,
    unconfirmed: () => confirms = false,
    omitEntry: () => packFiles = ["package.json"],
  };
}
test("npm publishes one packed archive after release and build checks", async () => {
  const f = fixture();
  await publishNpm(f.input);
  assertEquals(
    f.calls.filter((call) => call.startsWith("npm publish")).length,
    1,
  );
  assertStringIncludes(
    f.calls.at(-1)!,
    "npm publish owner-repo-1.2.3.tgz --ignore-scripts --json --access=public --registry=https://registry.npmjs.org/ --tag=latest",
  );
  assertEquals(
    f.calls.indexOf("deno task npm-build") <
      f.calls.indexOf("npm pack --json --ignore-scripts"),
    true,
  );
});
test("npm accepts only the identical existing version without uploading", async () => {
  const f = fixture();
  f.existing(expected);
  await publishNpm(f.input);
  assertEquals(f.calls.some((call) => call.startsWith("npm publish")), false);
  for (
    const changed of [
      { gitHead: "b".repeat(40) },
      { integrity: "sha512-" + "b".repeat(86) + "==" },
      { name: "@other/package" },
      { version: "2.0.0" },
    ]
  ) {
    const conflict = fixture();
    conflict.existing({ ...expected, ...changed });
    await assertRejects(() => publishNpm(conflict.input), TypeError, "differs");
    assertEquals(
      conflict.calls.some((call) => call.startsWith("npm publish")),
      false,
    );
  }
});
test("npm confirms uncertain writes and bounds failed publication without re-uploading", async () => {
  const uncertain = fixture();
  uncertain.fail();
  await publishNpm(uncertain.input);
  const missing = fixture();
  missing.fail();
  missing.unconfirmed();
  await assertRejects(() => publishNpm(missing.input), Error, "not confirmed");
  assertEquals(
    missing.calls.filter((call) => call.startsWith("npm publish")).length,
    1,
  );
});
test("npm publication reports known error codes without process output", async () => {
  for (
    const code of ["E403", "E429", "ENEEDAUTH", "ETIMEDOUT", "private-code"]
  ) {
    const f = fixture();
    const base = f.input.process;
    f.input.process = {
      async run(command, args) {
        if (command !== "npm" || args[0] !== "publish") {
          return await base.run(command, args);
        }
        f.calls.push(`${command} ${args.join(" ")}`);
        return {
          success: false,
          code: 1,
          stdout: new TextEncoder().encode(JSON.stringify({
            error: {
              code,
              summary: "dummy-private-value",
              detail: "dummy-detail",
            },
          })),
          stderr: new TextEncoder().encode("dummy-private-stderr"),
        };
      },
    };
    const error = await assertRejects(() => publishNpm(f.input), Error);
    assertEquals(
      error.message,
      "npm publication was not confirmed. npm publish exit code: 1." +
        (code === "private-code" ? "" : ` npm error code: ${code}.`) +
        " Retry this workflow with the same release tag.",
    );
    assertEquals(
      f.calls.filter((call) => call.startsWith("npm publish")).length,
      1,
    );
  }
});
test("npm publication retains confirmation after a process exception", async () => {
  for (const confirmed of [true, false]) {
    const f = fixture();
    const base = f.input.process;
    f.input.process = {
      async run(command, args) {
        if (command !== "npm" || args[0] !== "publish") {
          return await base.run(command, args);
        }
        if (confirmed) f.existing(expected);
        throw new Error("dummy-private-exception");
      },
    };
    if (confirmed) {
      await publishNpm(f.input);
    } else {
      const error = await assertRejects(() => publishNpm(f.input), Error);
      assertEquals(
        error.message,
        "npm publication was not confirmed. npm publish process result is unavailable. Retry this workflow with the same release tag.",
      );
    }
  }
});
test("npm rejects mismatched builds and missing packed entry points", async () => {
  for (
    const mutation of [{ name: "@other/package" }, { version: "2.0.0" }, {
      gitHead: "b".repeat(40),
    }, { bin: { repo: "../escape.js" } }]
  ) {
    const f = fixture();
    f.mutate(mutation);
    await assertRejects(() => publishNpm(f.input), TypeError);
    assertEquals(f.calls.some((call) => call.startsWith("npm publish")), false);
  }
  const omitted = fixture();
  omitted.omitEntry();
  await assertRejects(() => publishNpm(omitted.input), TypeError, "omits");
});
test("npm requires package identity, build task, and clean checkout", async () => {
  for (
    const config of [{ version: "1.2.3" }, {
      name: "@owner/repo",
      version: "1.2.3",
    }]
  ) {
    const f = fixture();
    f.input.files = files(JSON.stringify(config));
    await assertRejects(() => publishNpm(f.input), TypeError);
    assertEquals(f.calls.includes("deno task npm-build"), false);
  }
  const dirty = fixture();
  dirty.input.process = process(dirty.calls, {
    "git status --porcelain=v1 --untracked-files=normal": " M mod.ts\n",
  });
  await assertRejects(() => publishNpm(dirty.input), TypeError, "clean");
});
test("npm registry adapter separates absent, unavailable, invalid and matching versions", async () => {
  const request = (status: number, body: unknown): typeof fetch => () =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));
  assertEquals(
    await npmHttpApi(request(404, {})).version("@owner/repo", "1.2.3"),
    undefined,
  );
  await assertRejects(
    () => npmHttpApi(request(401, {})).version("@owner/repo", "1.2.3"),
    Error,
    "lookup failed",
  );
  await assertRejects(
    () => npmHttpApi(request(200, {})).version("@owner/repo", "1.2.3"),
    TypeError,
    "metadata",
  );
  const api = npmHttpApi(request(200, { ...manifest, dist: { integrity } }));
  assertEquals(await api.version("@owner/repo", "1.2.3"), expected);
});
test("npm local build reader requires regular confined files", async () => {
  const path = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "npm-files-",
  });
  try {
    await mkdir(`${path}/.hj/npm/bin`, { recursive: true });
    await writeTextFile(`${path}/.hj/npm/bin/cli.js`, "example");
    const reader = localNpmBuildFiles(new URL(`file://${path}/`));
    assertEquals(await reader.read("bin/cli.js"), "example");
    await assertRejects(() => reader.read("../escape"), TypeError, "invalid");
    await assertRejects(() => reader.read("bin"), TypeError, "regular file");
    const link = await runCommand("deno", {
      args: [
        "eval",
        "await Deno.symlink(Deno.args[0], Deno.args[1]);",
        `${path}/.hj/npm/bin/cli.js`,
        `${path}/.hj/npm/final.tgz`,
      ],
    });
    assertEquals(link.code, 0);
    await assertRejects(
      () => reader.read("final.tgz"),
      TypeError,
      "regular file",
    );
    await assertRejects(
      () => reader.read("bin/cli.js/subpath"),
      TypeError,
      "directory",
    );
  } finally {
    await remove(path, { recursive: true });
  }
});

test("npm CLI command routes through the publisher and preserves dependency injection", async () => {
  const { runCli } = await import("../cli/run-cli.ts");
  const f = fixture();
  const result = await runCli(f.input.root, ["release", "publish-npm"], {
    releaseEnvironment: f.input.environment,
    releaseProcess: f.input.process,
    publisherFiles: f.input.files,
    npmBuildFiles: f.input.buildFiles,
    npmApi: f.input.api,
  });
  assertEquals(result.output, "npm publication finished.");
  await assertRejects(
    () => runCli(f.input.root, ["release", "publish-npm", "extra"], {}),
    Error,
    "expected",
  );
});

test("npm accepts current keyed pack output and rejects unsafe publish configuration", async () => {
  const f = fixture();
  const base = f.input.process;
  f.input.process = {
    async run(command, args) {
      const result = await base.run(command, args);
      if (command !== "npm" || args[0] !== "pack") return result;
      const entries = JSON.parse(new TextDecoder().decode(result.stdout));
      return ok(JSON.stringify({ [manifest.name]: entries[0] }));
    },
  };
  await publishNpm(f.input);
  const invalid = fixture();
  invalid.input.buildFiles = {
    read: () =>
      Promise.resolve(
        JSON.stringify({
          ...manifest,
          publishConfig: { tag: "latest", ignoreScripts: false },
        }),
      ),
  };
  await assertRejects(
    () => publishNpm(invalid.input),
    TypeError,
    "public npm registry",
  );
});

test("npm inspects and publishes a finalized archive without repacking the directory", async () => {
  const f = fixture();
  const finalized = { ...manifest, hjNpmArchive: "final.tgz" };
  f.input.buildFiles.read = (path: string) =>
    Promise.resolve(
      path === "package.json" ? JSON.stringify(finalized) : "archive or entry",
    );
  const original = f.input.process.run;
  f.input.process.run = (command: string, args: readonly string[]) => {
    if (command === "tar") {
      return Promise.resolve(ok(JSON.stringify(finalized)));
    }
    return original(command, args);
  };
  await publishNpm(f.input);
  assertEquals(
    f.calls.includes("npm pack --json --ignore-scripts --dry-run final.tgz"),
    true,
  );
  assertEquals(f.calls.includes("npm pack --json --ignore-scripts"), false);
  assertStringIncludes(f.calls.at(-1)!, "npm publish final.tgz");
});

test("npm rejects invalid finalized archive paths and mismatched archived manifests", async () => {
  for (
    const archive of [
      "../escape.tgz",
      "dir/archive.tgz",
      "-option.tgz",
      42,
      "bad.zip",
    ]
  ) {
    const f = fixture();
    f.input.buildFiles.read = () =>
      Promise.resolve(JSON.stringify({ ...manifest, hjNpmArchive: archive }));
    await assertRejects(
      () => publishNpm(f.input),
      TypeError,
      "archive filename",
    );
    assertEquals(f.calls.some((call) => call.startsWith("npm publish")), false);
  }
  for (
    const mismatch of [
      { gitHead: "b".repeat(40) },
      { version: "2.0.0" },
      { name: "@other/package" },
      { bin: { repo: "other.js" } },
    ]
  ) {
    const f = fixture();
    const finalized = { ...manifest, hjNpmArchive: "final.tgz" };
    f.input.buildFiles.read = (path: string) =>
      Promise.resolve(
        path === "package.json"
          ? JSON.stringify(finalized)
          : "archive or entry",
      );
    const original = f.input.process.run;
    f.input.process.run = (command: string, args: readonly string[]) => {
      if (command === "tar") {
        return Promise.resolve(
          ok(JSON.stringify({ ...finalized, ...mismatch })),
        );
      }
      return original(command, args);
    };
    await assertRejects(
      () => publishNpm(f.input),
      TypeError,
      "archive manifest differs",
    );
    assertEquals(f.calls.some((call) => call.startsWith("npm publish")), false);
  }
});
