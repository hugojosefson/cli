import { spawnSync } from "node:child_process";
import { externalDeno } from "../testing/runtime-test-fixtures.ts";

export async function captureSummaryTask(
  root: URL,
  env: Record<string, string>,
) {
  const deno = (globalThis as {
    Deno?: {
      Command: new (command: string, options: {
        args: string[];
        cwd: URL;
        env: Record<string, string>;
        clearEnv: true;
        stdout: "piped";
        stderr: "piped";
      }) => {
        output(): Promise<
          { success: boolean; stdout: Uint8Array; stderr: Uint8Array }
        >;
      };
    };
  }).Deno;
  if (deno) {
    return await new deno.Command(externalDeno, {
      args: ["task", "all"],
      cwd: root,
      env,
      clearEnv: true,
      stdout: "piped",
      stderr: "piped",
    }).output();
  }
  const result = spawnSync(externalDeno, ["task", "all"], {
    cwd: root,
    env,
    timeout: 30000,
  });
  if (result.error) {
    throw result.error;
  }
  return {
    success: result.status === 0,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export function nativeSummaryFixture(runtime = "node24") {
  return {
    runtime,
    cacheEligible: false,
    context: "a".repeat(64),
    groups: Object.fromEntries(
      ["github-repository", "release-core"].map((name) => [
        name,
        {
          key: "b".repeat(64),
          inputs: Object.fromEntries(
            ["configuration", "packages", "dependencies", "tools"].map((
              name,
            ) => [
              name,
              "c".repeat(64),
            ]),
          ),
        },
      ]),
    ),
    buildMs: 123.5,
    buildObservationMs: 45,
    observationMs: 0,
  };
}
