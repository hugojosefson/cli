import { assert, assertEquals } from "@std/assert";
import { parseFeatures } from "../cli/parse-features.ts";
import { runFeatures } from "../cli/run-features.ts";
import { builtInFeatureRegistry } from "./built-in-feature-registry.ts";

Deno.test("empty server project serves through native Deno and both tasks, with live reload", async () => {
  const path = await Deno.makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-server-http-",
  });
  const root = new URL(`file://${path}/`);
  try {
    await runFeatures(
      root,
      parseFeatures(
        ["repo", "features", "--deno-server"],
        builtInFeatureRegistry,
      ),
    );
    // Keep the generated commands and watch mode, but let the OS select test ports.
    const configUrl = new URL("deno.jsonc", root);
    const config = JSON.parse(await Deno.readTextFile(configUrl));
    for (const name of ["serve", "dev"]) {
      config.tasks[name].command = config.tasks[name].command.replace(
        "deno serve",
        "deno serve --port=0",
      );
    }
    await Deno.writeTextFile(configUrl, JSON.stringify(config));
    for (
      const [args, watch] of [
        [
          ["serve", "--host=127.0.0.1", "--port=0", "src/server/server.ts"],
          false,
        ],
        [["task", "serve"], false],
        [["task", "dev"], true],
      ] as const
    ) {
      const child = new Deno.Command("deno", {
        args: [...args],
        cwd: path,
        env: { NO_COLOR: "1" },
        stdin: "null",
        stdout: "null",
        stderr: "piped",
      }).spawn();
      let log = "";
      const capture = (async () => {
        for await (const chunk of child.stderr) {
          log += new TextDecoder().decode(chunk);
        }
      })();
      let exited = false;
      const status = child.status.then((value) => {
        exited = true;
        return value;
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
          const source = await Deno.readTextFile(file);
          await Deno.writeTextFile(
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
    await Deno.remove(path, { recursive: true });
  }
});
