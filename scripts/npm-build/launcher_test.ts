import { test as nativeTest } from "node:test";
import { runRawCommand } from "../../src/runtime/command.ts";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertEquals, assertStringIncludes } from "@std/assert";
import { trackTests } from "../../src/testing/inventory-test-fixtures.ts";
import {
  nativeLauncherSource,
  nativeRuntimeCheck,
  nativeRuntimeEngines,
} from "./launcher.ts";
const test = trackTests(import.meta.url, nativeTest);

test("native launcher accepts stable engine ranges and checks actual runtime identity", () => {
  const supports = new Function("process", `return ${nativeRuntimeCheck};`);
  assertEquals(nativeRuntimeEngines, { node: ">=24.0.0", bun: ">=1.4.2" });
  for (
    const [versions, accepted] of [
      [{ node: "23.99.99" }, false],
      [{ node: "24.0.0" }, true],
      [{ node: "24.21.0" }, true],
      [{ node: "26.2.0" }, true],
      [{ node: "30.0.0" }, true],
      [{ node: "24.0.0-rc.1" }, false],
      [{ node: "26.0.0-nightly" }, false],
      [{ node: "24.0.0+build.1" }, true],
      [{ node: "broken" }, false],
      [{ node: "24.0.0", bun: "1.4.1" }, false],
      [{ node: "23.0.0", bun: "1.4.2" }, true],
      [{ bun: "1.4.3" }, true],
      [{ bun: "1.5.0" }, true],
      [{ bun: "2.0.0" }, true],
      [{ bun: "1.4.2-canary" }, false],
      [{ node: "24.0.0", deno: "2.9.6" }, false],
      [{}, false],
    ] as const
  ) {
    assertEquals(supports({ versions }), accepted, JSON.stringify(versions));
  }
});

test("native shell launcher selects a suitable runtime and preserves symlinked arguments and cwd", async () => {
  const root = await mkdtemp("/tmp/opencode/hj launcher ");
  try {
    const caller = join(root, "caller with spaces");
    await mkdir(caller);
    const launcher = join(root, "hj.js");
    await writeFile(launcher, nativeLauncherSource());
    const link = join(root, "linked hj");
    const linked = await runRawCommand("sh", {
      args: ["-c", 'ln -s "$1" "$2"', "sh", launcher, link],
    });
    assertEquals(linked.code, 0);
    const args = ["", "a b", "'quoted'", '"double"', "$HOME", "*", "x\ny"];
    for (
      const [name, node, bun, selected] of [
        ["node-only", true, undefined, "node"],
        ["bun-only", undefined, true, "bun"],
        ["both", true, true, "node"],
        ["unsupported-node", false, true, "bun"],
        ["unsupported-bun", undefined, false, undefined],
        ["both-unsupported", false, false, undefined],
        ["absent", undefined, undefined, undefined],
      ] as const
    ) {
      const bin = join(root, name);
      await mkdir(bin);
      for (const [runtime, supported] of [["node", node], ["bun", bun]]) {
        if (supported === undefined) continue;
        const path = join(bin, String(runtime));
        await writeFile(
          path,
          `#!/bin/sh
if [ "$1" = -e ]; then printf 'hidden probe output\\n'; printf 'hidden probe error\\n' >&2; exit ${
            supported ? 0 : 1
          }; fi
printf '%s\\n' '${runtime}' "$PWD" "$@"
exit 37
`,
        );
        await chmod(path, 0o755);
      }
      const result = await runRawCommand("sh", {
        args: [
          "-c",
          'PATH="$1"; export PATH; shift; exec /bin/sh "$@"',
          "sh",
          bin,
          link,
          ...args,
        ],
        cwd: caller,
      });
      const stdout = new TextDecoder().decode(result.stdout);
      const stderr = new TextDecoder().decode(result.stderr);
      if (selected) {
        assertEquals(result.code, 37, name);
        assertEquals(
          stdout,
          [selected, caller, link, ...args, ""].join("\n"),
          name,
        );
        assertEquals(stderr, "", name);
      } else {
        assertEquals(result.code, 127, name);
        assertEquals(stdout, "", name);
        assertStringIncludes(stderr, "Node.js >=24.0.0 or Bun >=1.4.2");
        assertStringIncludes(stderr, "add it to PATH");
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("native shell launcher replaces itself and preserves runtime termination signals", async () => {
  const root = await mkdtemp("/tmp/opencode/hj launcher signal ");
  try {
    const launcher = join(root, "hj.js");
    await writeFile(launcher, nativeLauncherSource());
    const node = join(root, "node");
    await writeFile(
      node,
      '#!/bin/sh\nif [ "$1" = -e ]; then exit 0; fi\nprintf "%s\\n" "$$" "$2"\nkill -TERM "$$"\n',
    );
    await chmod(node, 0o755);
    const result = await runRawCommand("sh", {
      args: [
        "-c",
        'PATH="$1"; export PATH; exec /bin/sh "$2" "$$"',
        "sh",
        root,
        launcher,
      ],
    });
    assertEquals(result.code, 143);
    const pids = new TextDecoder().decode(result.stdout).trim().split("\n");
    assertEquals(pids.length, 2);
    assertEquals(pids[0], pids[1]);
    assertEquals(new TextDecoder().decode(result.stderr), "");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
