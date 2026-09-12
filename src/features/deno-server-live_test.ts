import { spawn } from "node:child_process";
import process from "node:process";
import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import {
  makeTempDir,
  readTextFile,
  remove,
  writeTextFile,
} from "../testing/files-test-fixtures.ts";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { parseFeatures } from "../cli/parse-features.ts";
import { runFeatureOperation } from "../cli/run-features.ts";
import { builtInFeatureRegistry } from "./built-in-feature-registry.ts";

test("generated server serves through Deno, tasks, and the executable CLI without prompts", async () => {
  const path = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-server-http-",
  });
  const root = new URL(`file://${path}/`);
  try {
    await runFeatures(
      root,
      parseFeatures(
        ["repo", "features", "--deno-server", "--deno-cli"],
        builtInFeatureRegistry,
      ),
    );
    // Keep the generated commands and watch mode, but let the OS select test ports.
    const configUrl = new URL("deno.jsonc", root);
    const config = JSON.parse(await readTextFile(configUrl));
    for (const name of ["serve", "dev"]) {
      config.tasks[name].command = config.tasks[name].command.replace(
        "deno serve",
        "deno serve --port=0",
      );
    }
    await writeTextFile(configUrl, JSON.stringify(config));
    const cliUrl = new URL("src/cli/cli.ts", root);
    const cli = await readTextFile(cliUrl);
    assertStringIncludes(cli, 'DENO_RUN_ARGS="--allow-net=0.0.0.0:8000"');
    await writeTextFile(cliUrl, cli.replace("0.0.0.0:8000", "0.0.0.0:0"));
    const adapterUrl = new URL("src/cli/serve-command.ts", root);
    const adapter = await readTextFile(adapterUrl);
    await writeTextFile(
      adapterUrl,
      adapter.replace("0.0.0.0:8000", "0.0.0.0:0").replace(
        "Deno.serve(server.fetch)",
        "Deno.serve({ port: 0 }, server.fetch)",
      ),
    );
    for (
      const [command, args, watch] of [
        [
          "deno",
          ["serve", "--host=127.0.0.1", "--port=0", "src/server/server.ts"],
          false,
        ],
        ["deno", ["task", "serve"], false],
        ["sh", ["-c", "exec ./src/cli/cli.ts serve"], false],
        ["deno", ["task", "dev"], true],
      ] as const
    ) {
      const child = spawn(command, [...args], {
        cwd: path,
        env: { PATH: process.env.PATH, NO_COLOR: "1", DENO_NO_PROMPT: "1" },
        stdio: ["ignore", "ignore", "pipe"],
      });
      let log = "";
      const capture = (async () => {
        for await (const chunk of child.stderr!) {
          log += new TextDecoder().decode(chunk);
        }
      })();
      let exited = false;
      const status = new Promise<void>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", () => {
          exited = true;
          resolve();
        });
      });
      let url = "";
      try {
        const response = async (expected: string): Promise<void> => {
          const deadline = Date.now() + 10_000;
          while (Date.now() < deadline) {
            assert(!exited, `Server exited: ${log}`);
            const ports = [
              ...log.matchAll(/Listening on http:\/\/[^:\s]+:(\d+)\//g),
            ];
            const port = ports.at(-1)?.[1];
            if (port) {
              url = `http://127.0.0.1:${port}/`;
              try {
                const result = await fetch(url, {
                  signal: AbortSignal.timeout(500),
                });
                if (result.ok && await result.text() === expected) return;
              } catch { /* Wait for the listener after a watch restart. */ }
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          throw new Error(`Server did not return ${expected}: ${log}`);
        };
        await response("Hello from Deno.serve.");
        if (watch) {
          const file = new URL("src/server/server.ts", root);
          const source = await readTextFile(file);
          await writeTextFile(
            file,
            source.replace("Hello from Deno.serve.", "Reloaded response."),
          );
          await response("Reloaded response.");
        }
      } finally {
        if (!exited) child.kill("SIGINT");
        await status;
        await capture;
      }
      // Deno task must stop its server child too, including the watch worker.
      let alive = false;
      try {
        const remaining = await fetch(url, {
          signal: AbortSignal.timeout(500),
        });
        await remaining.body?.cancel();
        alive = true;
      } catch { /* Connection closed after shutdown. */ }
      assertEquals(alive, false, "A server process survived task shutdown.");
    }
  } finally {
    await remove(path, { recursive: true });
  }
});

// These fixtures inspect generated features and execute their tasks separately.
function runFeatures(
  root: URL,
  args: Parameters<typeof runFeatureOperation>[1],
) {
  return runFeatureOperation(root, args, builtInFeatureRegistry, undefined, {
    runFinalTask: () => Promise.resolve(undefined),
  });
}
