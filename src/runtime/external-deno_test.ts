import { test } from "node:test";
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { acquireDeno, cachedDeno } from "./deno-install.ts";
import {
  type DenoResolverHost,
  localDenoHost,
  resolveExternalDeno,
} from "./external-deno.ts";
import { runCommand, runRawCommand } from "./command.ts";
import { runCli } from "../cli/run-cli.ts";
import { withDenoOptions } from "./deno-options.ts";

async function fixture(
  action: (
    root: URL,
    host: DenoResolverHost,
    installs: string[],
    notices: string[],
  ) => Promise<void>,
) {
  const directory = await fs.mkdtemp("/tmp/opencode/hj-deno-resolve-");
  const installs: string[] = [];
  const notices: string[] = [];
  const host: DenoResolverHost = {
    path: "",
    cacheRoot: () => join(directory, "cache"),
    assertPlatform: () => Promise.resolve(),
    version: async (path) => (await fs.readFile(path, "utf8")).trim(),
    install: async (staging, version) => {
      installs.push(version);
      await fs.mkdir(join(staging, "bin"));
      await fs.writeFile(join(staging, "bin/deno"), version, { mode: 0o755 });
    },
    report: (message) => notices.push(message),
  };
  try {
    await action(pathToFileURL(directory + "/"), host, installs, notices);
  } finally {
    await fs.rm(directory, { recursive: true });
  }
}

test("resolver reuses suitable host and PATH binaries before caches or installs", async () => {
  await fixture(async (root, host, installs) => {
    const current = { path: "/verified/current/deno", version: "2.9.8" };
    assertEquals(
      await resolveExternalDeno(root, {}, { ...host, current }),
      current,
    );
    const first = new URL("first/", root);
    const second = new URL("second/", root);
    for (const directory of [first, second]) await fs.mkdir(directory);
    await fs.writeFile(new URL("deno", first), "2.8.0", { mode: 0o755 });
    await fs.writeFile(new URL("deno", second), "2.10.2", { mode: 0o755 });
    const path = `${
      new URL("missing", root).pathname
    }:${first.pathname}:${first.pathname}:${second.pathname}`;
    assertEquals(
      (await resolveExternalDeno(root, {}, { ...host, path })).version,
      "2.10.2",
    );
    assertEquals(installs, []);
  });
});

test("resolver obtains recorded versions, reuses highest compatible cache offline, and preserves exact pins", async () => {
  await fixture(async (root, host, installs, notices) => {
    const first = await resolveExternalDeno(root, {}, host);
    assertEquals(first.version, "2.9.6");
    assertEquals(installs, ["2.9.6"]);
    assertStringIncludes(notices[0], "Downloading Deno 2.9.6");
    assertEquals(
      await resolveExternalDeno(root, { offline: true }, host),
      first,
    );
    const newer = await resolveExternalDeno(
      root,
      { requirement: "2.10.2" },
      host,
    );
    assertEquals(
      (await resolveExternalDeno(root, { offline: true }, host)).path,
      newer.path,
    );
    assertEquals(
      await resolveExternalDeno(
        root,
        { requirement: "2.9.6", offline: true },
        host,
      ),
      first,
    );
    await assertRejects(
      () =>
        resolveExternalDeno(
          root,
          { requirement: "3.0.0", offline: true },
          host,
        ),
      Error,
      "Offline mode",
    );
    await assertRejects(
      () => resolveExternalDeno(root, { requirement: "3.0.x" }, host),
      Error,
      "Record an exact preferred",
    );
    const selected = await resolveExternalDeno(root, {
      requirement: "3.0.x",
      preferred: "3.0.2",
    }, host);
    assertEquals(selected.version, "3.0.2");
  });
});

test("cache installation is atomic, deduplicated, verified, and recoverable after failure", async () => {
  await fixture(async (root, host, installs) => {
    const [a, b] = await Promise.all([
      resolveExternalDeno(root, {}, host),
      resolveExternalDeno(root, {}, host),
    ]);
    assertEquals(a, b);
    assertEquals(installs, ["2.9.6"]);
    const cache = join(host.cacheRoot(), "deno/linux-x64-glibc");
    await assertRejects(
      () =>
        acquireDeno(
          cache,
          "2.9.7",
          () => Promise.reject(new Error("install failed")),
          host.version,
        ),
      Error,
      "install failed",
    );
    await assertRejects(
      () =>
        acquireDeno(
          cache,
          "2.9.7",
          host.install,
          () => Promise.resolve("wrong"),
        ),
      Error,
      "expected version",
    );
    assertEquals(await cachedDeno(join(cache, "2.9.7"), "2.9.7"), undefined);
    assertEquals(
      (await fs.readdir(cache)).filter((name) => name.startsWith(".install-")),
      [],
    );
    await fs.writeFile(a.path, "tampered");
    await assertRejects(
      () => resolveExternalDeno(root, { offline: true }, host),
      Error,
      "Invalid Deno cache",
    );
    await fs.rm(join(cache, "2.9.6"), { recursive: true });
    await fs.mkdir(join(cache, "2.9.6"));
    await assertRejects(
      () => cachedDeno(join(cache, "2.9.6"), "2.9.6"),
      Error,
      "Invalid Deno cache",
    );
  });
});

test("concurrent cache publication accepts a complete winner and refuses symlinks", async () => {
  await fixture(async (_root, host) => {
    const cache = join(host.cacheRoot(), "race");
    const winnerCache = join(host.cacheRoot(), "winner");
    await acquireDeno(winnerCache, "2.9.6", host.install, host.version);
    const selected = await acquireDeno(
      cache,
      "2.9.6",
      async (staging, version) => {
        await host.install(staging, version);
        await fs.rename(join(winnerCache, version), join(cache, version));
      },
      host.version,
    );
    assertEquals(selected.version, "2.9.6");
    await runCommand("sh", {
      args: [
        "-c",
        'ln -s "$1" "$2"',
        "sh",
        join(cache, "2.9.6"),
        join(cache, "2.9.7"),
      ],
    });
    await assertRejects(
      () => cachedDeno(join(cache, "2.9.7"), "2.9.7"),
      Error,
      "Invalid Deno cache",
    );
  });
});

test("cancellation stops resolution and prevents publishing an interrupted download", async () => {
  await fixture(async (root, host, installs) => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    await assertRejects(
      () => resolveExternalDeno(root, { signal: controller.signal }, host),
      Error,
      "cancelled",
    );
    assertEquals(installs, []);
    const active = new AbortController();
    await assertRejects(
      () =>
        resolveExternalDeno(root, { signal: active.signal }, {
          ...host,
          install: async (staging, version) => {
            await host.install(staging, version);
            active.abort(new Error("cancel download"));
          },
        }),
      Error,
      "cancel download",
    );
    assertEquals(
      await fs.readdir(join(host.cacheRoot(), "deno/linux-x64-glibc")),
      [],
    );
  });
});

test("cache locations honor XDG and HOME without a separate version default", () => {
  assertEquals(
    localDenoHost("", undefined, { XDG_CACHE_HOME: "/tmp/cache" }).cacheRoot(),
    "/tmp/cache/hj",
  );
  assertEquals(
    localDenoHost("", undefined, { HOME: "/tmp/home" }).cacheRoot(),
    "/tmp/home/.cache/hj",
  );
  assertThrows(() =>
    localDenoHost("", undefined, { XDG_CACHE_HOME: "relative" }).cacheRoot()
  );
  assertThrows(() => localDenoHost("", undefined, {}).cacheRoot());
});

test("genuine Deno tasks use the selected binary for nested deno calls", async () => {
  await fixture(async (root) => {
    const result = await runCommand("deno", {
      cwd: root,
      args: [
        "eval",
        'const child = await new Deno.Command("deno", { args: ["eval", "console.log(Deno.execPath())"] }).output(); console.log(Deno.execPath()); console.log(new TextDecoder().decode(child.stdout).trim());',
      ],
    });
    assertEquals(result.success, true);
    const paths = new TextDecoder().decode(result.stdout).trim().split("\n");
    assertEquals(paths[0], paths[1]);
    const denied = new AbortController();
    denied.abort(new Error("task aborted"));
    await assertRejects(
      () => runCommand("deno", { cwd: root, signal: denied.signal }),
      Error,
      "task aborted",
    );
  });
});

test("help does not inspect malformed project requirements or resolve an unavailable Deno", async () => {
  await fixture(async (root) => {
    await fs.writeFile(new URL(".deno-version", root), "invalid");
    const result = await runCli(root, [
      "--runtime-deno=999.0.0",
      "--offline",
      "--help",
    ]);
    assertStringIncludes(result.output, "--runtime-deno");
    const status = await runCli(root, ["repo", "features", "--offline"]);
    assertStringIncludes(status.output, "Feature");
    await withDenoOptions(
      { requirement: "999.0.0", offline: true },
      async () => {
        const result = await runCommand("git", {
          args: ["--version"],
          cwd: root,
        });
        assertEquals(result.success, true);
      },
    );
  });
});

test("aborting a native command waits for child cleanup and propagates cancellation", async () => {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("cancel running command")),
    20,
  );
  try {
    await assertRejects(
      () =>
        runRawCommand("sh", {
          args: ["-c", "exec sleep 30"],
          signal: controller.signal,
        }),
      Error,
      "cancel running command",
    );
  } finally {
    clearTimeout(timer);
  }
});
