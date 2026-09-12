/** Real release subprocesses with explicit test-owned environment and Git policy. */
import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { constants } from "node:os";
import { delimiter, dirname } from "node:path";
import process from "node:process";
import { prepareRelease } from "./publish-tag-prepare-core.ts";
import type { ReleaseEnvironment } from "./release-environment.ts";
import type { ReleaseProcess } from "./release-process.ts";

/** Core cases declare no publisher workflow; production wiring has its own test. */
export function prepareReleaseFixture(
  root: URL,
  environment: ReleaseEnvironment,
  process: ReleaseProcess,
) {
  return prepareRelease(root, environment, process, () => Promise.resolve());
}

export function isolatedReleaseProcess(root: URL): ReleaseProcess {
  const deno = process.env.HJ_TEST_DENO;
  if (!deno) {
    throw new Error("Release fixtures require the runner's Deno executable");
  }
  const environment = {
    PATH: `${dirname(deno)}${delimiter}${process.env.PATH ?? ""}`,
    LC_ALL: "C",
    TZ: "UTC",
    NO_COLOR: "1",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_ATTR_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    DENO_NO_UPDATE_CHECK: "1",
  };
  return {
    run(command, args, options = {}) {
      const actualArgs = command === "git"
        ? [
          "-c",
          "init.templateDir=",
          "-c",
          "core.hooksPath=/dev/null",
          "-c",
          "commit.gpgSign=false",
          "-c",
          "tag.gpgSign=false",
          ...args,
        ]
        : [...args];
      return new Promise((resolve, reject) => {
        const child = spawn(command === "deno" ? deno : command, actualArgs, {
          cwd: options.cwd ?? root,
          env: { ...environment, ...options.env },
          stdio: [
            options.stdin === undefined ? "ignore" : "pipe",
            "pipe",
            "pipe",
          ],
        });
        const stdout: Uint8Array[] = [];
        const stderr: Uint8Array[] = [];
        child.stdout!.on("data", (chunk: Uint8Array) => stdout.push(chunk));
        child.stderr!.on("data", (chunk: Uint8Array) => stderr.push(chunk));
        let failure: Error | undefined;
        child.on("error", (error) => {
          failure = error;
        });
        child.stdin?.on("error", (error) => {
          failure = error;
          child.kill();
        });
        child.on("close", (code, signal) => {
          if (failure) {
            reject(failure);
            return;
          }
          const exitCode = code ??
            (signal ? 128 + constants.signals[signal] : 1);
          resolve({
            success: exitCode === 0,
            code: exitCode,
            stdout: Buffer.concat(stdout),
            stderr: Buffer.concat(stderr),
          });
        });
        if (options.stdin !== undefined) child.stdin!.end(options.stdin);
      });
    },
  };
}
