import { serveFixture } from "../testing/network-test-fixtures.ts";
import {
  makeTempDir,
  mkdir,
  readTextFile,
  remove,
  writeTextFile,
} from "../testing/files-test-fixtures.ts";
import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import { runRawCommand as runCommand } from "../runtime/command.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { runFeatureOperation } from "../cli/run-features.ts";
import { parseFeatures } from "../cli/parse-features.ts";
import { buildReadme } from "../readme/build-readme.ts";
import { reconcileBlocks } from "../readme/contribution-blocks.ts";
import { LocalFileReader } from "../repository/local-file-reader.ts";
import { LocalGitReader } from "../repository/local-git-reader.ts";
import { reconcileReadmePlans } from "./readme-contribution-plans.ts";
import { applyLocalChangePlan } from "../operations/local-change-plan.ts";
import { builtInFeatureRegistry } from "./built-in-feature-registry.ts";
import type { OperationContext } from "../api/repository-context.ts";

// License transport has separate tests. Keep this complete feature operation
// offline by supplying an already enabled license provider.
const registry = {
  ...builtInFeatureRegistry,
  features: builtInFeatureRegistry.features.map((feature) =>
    feature.metadata.id === "license-mit"
      ? {
        ...feature,
        detect: () =>
          Promise.resolve({ state: "enabled" as const, evidence: [] }),
      }
      : feature
  ),
};
async function runCli(root: URL, args: readonly string[]) {
  return await runFeatureOperation(
    root,
    parseFeatures(args, registry),
    registry,
    () => [],
    {
      runFinalTask: () => Promise.resolve(undefined),
      jsrScopes: {
        scopes: () => Promise.resolve({ kind: "missing-authentication" }),
      },
    },
  );
}

async function fixture(run: (root: URL) => Promise<void>) {
  const path = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "readme-guides-",
  });
  const root = new URL(`file://${path}/`);
  try {
    await writeTextFile(
      new URL("deno.json", root),
      JSON.stringify({ name: "@sample/tool" }),
    );
    await writeTextFile(
      new URL("README.md", root),
      "# Existing heading\n\nKeep this introduction.\n\n## License\n\n[MIT](./LICENSE)\n",
    );
    await run(root);
  } finally {
    await remove(root, { recursive: true });
  }
}
const read = (root: URL, path: string) => readTextFile(new URL(path, root));
async function enable(root: URL, provider = "readme-build") {
  await runCli(root, [
    "repo",
    "features",
    "--deno-lib",
    "--deno-cli",
    "--jsr-package",
    `--${provider}`,
    "--yes",
  ]);
}

for (const provider of ["readme-static", "readme-build"]) {
  test(`${provider} contributes guides and a runnable published example without duplicate changes`, async () => {
    await fixture(async (root) => {
      await enable(root, provider);
      const source = await read(
        root,
        provider === "readme-build" ? "readme/README.md" : "README.md",
      );
      const output = await read(root, "README.md");
      assertStringIncludes(
        output,
        "# Existing heading\n\nKeep this introduction.",
      );
      assertStringIncludes(
        output,
        "[![JSR Score](https://jsr.io/badges/@sample/tool/score)]",
      );
      assertStringIncludes(
        output,
        'import { placeholder } from "@sample/tool";',
      );
      assertStringIncludes(output, "console.dir({ result });");
      assertStringIncludes(
        output,
        "deno install --global --name tool jsr:@sample/tool/cli",
      );
      assertStringIncludes(
        output,
        "deno run --reload jsr:@sample/tool/example-usage",
      );
      assertStringIncludes(
        output,
        provider === "readme-build"
          ? "[test/lib_test.ts](test/lib_test.ts)"
          : "[test/lib_test.ts](./test/lib_test.ts)",
      );
      assert(output.indexOf("## Example usage") < output.indexOf("## License"));
      assertStringIncludes(output, "hj:readme deno-lib:api");
      assertEquals(output.includes("hj:readme jsr-package:api"), false);
      assertEquals(
        await read(root, "readme/install.sh"),
        "#!/usr/bin/env bash\ndeno add jsr:@sample/tool\n",
      );
      assertEquals(
        await read(root, "readme/example-usage.ts"),
        'import { placeholder } from "../src/lib/mod.ts";\n\nconst result = placeholder();\nconsole.dir({ result });\n',
      );
      assertEquals(
        JSON.parse(await read(root, "deno.json")).exports["./example-usage"],
        "./readme/example-usage.ts",
      );
      if (provider === "readme-build") {
        assertStringIncludes(source, "@@include(./install.sh)");
        assertStringIncludes(source, "@@include(./example-usage.ts)");
        assertEquals(await buildReadme(root), output);
      } else assert(!source.includes("@@include("));
      await enable(root, provider);
      assertEquals(await read(root, "README.md"), output);
      const result = await runCommand("deno", {
        args: ["run", "readme/example-usage.ts"],
        cwd: root,
        stdout: "piped",
        stderr: "piped",
      });
      assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
      assertStringIncludes(
        new TextDecoder().decode(result.stdout),
        "result: undefined",
      );
    });
  });
}

test("rename refreshes owned guides and install files while preserving custom sections", async () => {
  await fixture(async (root) => {
    await enable(root);
    const config = JSON.parse(await read(root, "deno.json"));
    config.name = "@different/renamed";
    config.hj = { commandName: "special" };
    await writeTextFile(
      new URL("deno.json", root),
      JSON.stringify(config),
    );
    const source = await read(root, "readme/README.md");
    await writeTextFile(
      new URL("readme/README.md", root),
      source.replace(
        "Requires [Deno](https://deno.com/).",
        "Our custom runtime instructions.",
      ),
    );
    await runCli(root, ["repo", "features", "--jsr-package", "--yes"]);
    const output = await read(root, "README.md");
    assertStringIncludes(output, "Our custom runtime instructions.");
    assertStringIncludes(output, "--name special jsr:@different/renamed/cli");
    assertStringIncludes(output, "deno add jsr:@different/renamed");
    assert(!output.includes("@sample/tool"));
    assertStringIncludes(
      await read(root, "readme/install.sh"),
      "@different/renamed",
    );
  });
});

test("README provider switches retain public examples and remove include directives from static output", async () => {
  await fixture(async (root) => {
    await enable(root);
    const example = await read(root, "readme/example-usage.ts");
    await runCli(root, ["repo", "features", "--readme-static", "--yes"]);
    assertEquals(await read(root, "readme/example-usage.ts"), example);
    assert(!(await read(root, "README.md")).includes("@@include("));
    await runCli(root, ["repo", "features", "--readme-build", "--yes"]);
    assertEquals(await read(root, "readme/example-usage.ts"), example);
    assertEquals(await buildReadme(root), await read(root, "README.md"));
  });
});

test("disabled owners remove unchanged blocks and examples but preserve custom public examples", async () => {
  await fixture(async (root) => {
    await enable(root, "readme-static");
    await runCli(root, ["repo", "features", "--no-deno-lib", "--yes"]);
    assertEquals((await read(root, "README.md")).includes("## API"), false);
    assert(
      !(await read(root, "README.md")).includes("## Example usage"),
      await read(root, "README.md"),
    );
    assertEquals(
      await new LocalFileReader(root).exists("readme/example-usage.ts"),
      false,
    );
    assertEquals(
      JSON.parse(await read(root, "deno.json")).exports["./example-usage"],
      undefined,
    );
    await runCli(root, ["repo", "features", "--deno-lib", "--yes"]);
    await writeTextFile(
      new URL("readme/example-usage.ts", root),
      'console.log("custom public example");\n',
    );
    await runCli(root, ["repo", "features", "--no-deno-lib", "--yes"]);
    assertEquals((await read(root, "README.md")).includes("## API"), false);
    assertEquals(
      await read(root, "readme/example-usage.ts"),
      'console.log("custom public example");\n',
    );
    assertEquals(
      JSON.parse(await read(root, "deno.json")).exports["./example-usage"],
      "./readme/example-usage.ts",
    );
    await runCli(root, ["repo", "features", "--no-jsr-package", "--yes"]);
    assert(!(await read(root, "README.md")).includes("[![JSR"));
    assertEquals(
      await new LocalFileReader(root).exists("readme/install.sh"),
      false,
    );
  });
});

test("command-only packages omit library guides and custom sections and scripts stay intact", async () => {
  await fixture(async (root) => {
    await mkdir(new URL("readme", root));
    await writeTextFile(
      new URL("readme/install.sh", root),
      "#!/bin/sh\necho custom\n",
    );
    await writeTextFile(
      new URL("README.md", root),
      "# Custom\n\n## API\n\nCustom API link.\n",
    );
    await runCli(root, [
      "repo",
      "features",
      "--deno-cli",
      "--jsr-package",
      "--readme-static",
      "--yes",
    ]);
    const output = await read(root, "README.md");
    assertEquals(output.match(/## API/g)?.length, 1);
    assertStringIncludes(output, "Custom API link.");
    assertStringIncludes(output, "echo custom");
    assert(!output.includes("## Example usage"));
    assert(!output.includes("[![CI]"));
    assertEquals(
      await read(root, "readme/install.sh"),
      "#!/bin/sh\necho custom\n",
    );
  });
});

test("contribution plans reject stale files before mutation", async () => {
  await fixture(async (root) => {
    await enable(root, "readme-static");
    const files = new LocalFileReader(root);
    const git = new LocalGitReader(root);
    const context = { repositoryRoot: root, files, git };
    const detections = new Map(
      await Promise.all(
        builtInFeatureRegistry.features.map(async (feature) =>
          [feature.metadata.id, await feature.detect(context)] as const
        ),
      ),
    );
    const config = JSON.parse(await read(root, "deno.json"));
    config.name = "@sample/renamed";
    await writeTextFile(
      new URL("deno.json", root),
      JSON.stringify(config),
    );
    const plans = await reconcileReadmePlans({
      ...context,
      detections,
      requestedChanges: [],
      resolvedChanges: [],
      repair: undefined,
      options: {},
    }, []);
    assert(plans.length > 0);
    const output = await read(root, "README.md");
    await writeTextFile(
      new URL("readme/install.sh", root),
      "custom edit\n",
    );
    await assertRejects(
      () => applyLocalChangePlan(root, plans[0]),
      Error,
      "precondition",
    );
    assertEquals(await read(root, "README.md"), output);
  });
});

test("the public example runs from a caller directory against a local publication fixture", async () => {
  await fixture(async (root) => {
    await enable(root, "readme-static");
    const config = JSON.parse(await read(root, "deno.json"));
    const exported = config.exports["./example-usage"];
    const requests: string[] = [];
    const files = new Map([
      ["/readme/example-usage.ts", await read(root, exported.slice(2))],
      ["/src/lib/mod.ts", await read(root, config.exports["."].slice(2))],
    ]);
    const server = await serveFixture(
      (request) => {
        const path = new URL(request.url).pathname;
        requests.push(path);
        const body = files.get(path);
        return new Response(body ?? "not found", {
          status: body === undefined ? 404 : 200,
          headers: { "content-type": "application/typescript" },
        });
      },
    );
    const outside = await makeTempDir({
      dir: "/tmp/opencode",
      prefix: "public-example-caller-",
    });
    try {
      // The import map substitutes the local publication for an unpublished JSR
      // package. Relative imports must fetch the same published module graph.
      const map = outside + "/import-map.json";
      await writeTextFile(
        map,
        JSON.stringify({
          imports: {
            "jsr:@sample/tool/example-usage":
              `http://127.0.0.1:${server.addr.port}${exported.slice(1)}`,
          },
        }),
      );
      const output = await runCommand("deno", {
        args: [
          "run",
          "--reload",
          "--no-config",
          "--import-map",
          map,
          "jsr:@sample/tool/example-usage",
        ],
        cwd: outside,
        stdout: "piped",
        stderr: "piped",
      });
      assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
      assertStringIncludes(
        new TextDecoder().decode(output.stdout),
        "result: undefined",
      );
      assertEquals(requests.sort(), [
        "/readme/example-usage.ts",
        "/src/lib/mod.ts",
      ]);
    } finally {
      await server.shutdown();
      await remove(outside, { recursive: true });
    }
  });
});

test("custom examples use the actual library export, retain publication settings and GitHub identity stays separate", async () => {
  await fixture(async (root) => {
    await enable(root, "readme-static");
    const config = JSON.parse(await read(root, "deno.json"));
    config.publish = { include: ["src"], exclude: ["test"] };
    await writeTextFile(
      new URL("deno.json", root),
      JSON.stringify(config),
    );
    const files = new LocalFileReader(root);
    const git = new LocalGitReader(root);
    const detections = new Map(
      ["readme-static", "deno-lib", "deno-cli", "jsr-package", "github-ci"].map(
        (id) => [id, { state: "enabled" as const, evidence: [] }],
      ),
    );
    const context: OperationContext = {
      repositoryRoot: root,
      files,
      git,
      detections,
      requestedChanges: [],
      resolvedChanges: [],
      repair: undefined,
      options: {},
      github: {
        repository: () =>
          Promise.resolve({ owner: "different-owner", name: "different-repo" }),
        rulesets: () => Promise.resolve([]),
        environments: () => Promise.resolve([]),
        variables: () => Promise.resolve([]),
        secretExists: () => Promise.resolve(false),
        resource: () => Promise.resolve(undefined),
      },
    };
    const plans = await reconcileReadmePlans(context, []);
    for (const plan of plans) await applyLocalChangePlan(root, plan);
    assertEquals(JSON.parse(await read(root, "deno.json")).publish, {
      include: ["src", "readme/example-usage.ts"],
      exclude: ["test"],
    });
    assertStringIncludes(
      await read(root, "README.md"),
      "https://github.com/different-owner/different-repo/actions/workflows/hj-ci.yaml/badge.svg",
    );
    const releaseContext: OperationContext = {
      ...context,
      resolvedChanges: [{
        featureId: "github-release-publish-tag",
        enabled: true,
        reason: { kind: "explicit-request" },
      }],
    };
    for (const plan of await reconcileReadmePlans(releaseContext, [])) {
      await applyLocalChangePlan(root, plan);
    }
    const releaseReadme = await read(root, "README.md");
    assertStringIncludes(
      releaseReadme,
      "hj-release-publish-tag.yaml/badge.svg?branch=main",
    );
    assertStringIncludes(
      releaseReadme,
      "hj-release-publish-tag.yaml?query=branch%3Amain",
    );
    assert(!releaseReadme.includes("hj-ci.yaml/badge.svg"));
    const detectedRelease: OperationContext = {
      ...context,
      detections: new Map([...detections, ["github-release-publish-tag", {
        state: "enabled" as const,
        evidence: [],
      }]]),
    };
    assertEquals(await reconcileReadmePlans(detectedRelease, []), []);
    const disabledRelease: OperationContext = {
      ...detectedRelease,
      resolvedChanges: [{
        featureId: "github-release-publish-tag",
        enabled: false,
        reason: { kind: "explicit-request" },
      }],
    };
    for (const plan of await reconcileReadmePlans(disabledRelease, [])) {
      await applyLocalChangePlan(root, plan);
    }
    assertStringIncludes(await read(root, "README.md"), "hj-ci.yaml/badge.svg");
    assert(!(await read(root, "README.md")).includes("hj-release-publish-tag"));
    assertStringIncludes(
      await read(root, "README.md"),
      "https://jsr.io/@sample/tool",
    );
    config.exports["./example-usage"] = "./custom-example.ts";
    await writeTextFile(
      new URL("deno.json", root),
      JSON.stringify(config),
    );
    await runCli(root, ["repo", "features", "--jsr-package", "--yes"]);
    assertEquals(
      JSON.parse(await read(root, "deno.json")).exports["./example-usage"],
      "./custom-example.ts",
    );
    assert(!(await read(root, "README.md")).includes("## Example usage"));
  });
});

test("build resolves a renamed owned install include without rewriting customized scripts", async () => {
  await fixture(async (root) => {
    await enable(root);
    const config = JSON.parse(await read(root, "deno.json"));
    config.name = "@sample/changed";
    await writeTextFile(
      new URL("deno.json", root),
      JSON.stringify(config),
    );
    const output = await buildReadme(root);
    assertStringIncludes(output, "deno add jsr:@sample/changed");
    assert(!output.includes("@sample/tool"));
    await writeTextFile(
      new URL("readme/install.sh", root),
      "#!/bin/sh\necho custom installation\n",
    );
    assertStringIncludes(await buildReadme(root), "echo custom installation");
  });
});

test("unsafe contribution paths fail before other feature changes apply", async () => {
  await fixture(async (root) => {
    await mkdir(new URL("readme", root));
    await mkdir(new URL("readme/install.sh", root));
    const original = await read(root, "deno.json");
    await assertRejects(
      () => enable(root, "readme-static"),
      Error,
      "regular file",
    );
    assertEquals(await read(root, "deno.json"), original);
    assertEquals(
      await new LocalFileReader(root).exists("src/lib/mod.ts"),
      false,
    );
  });
});

test("built README removes disabled guides and preserves files included by customized blocks", async () => {
  await fixture(async (root) => {
    await enable(root);
    await runCli(root, ["repo", "features", "--no-deno-lib", "--yes"]);
    assertEquals((await read(root, "README.md")).includes("## API"), false);
    assert(!(await read(root, "README.md")).includes("## Example usage"));
    assertEquals(await buildReadme(root), await read(root, "README.md"));
    const source = await read(root, "readme/README.md");
    await writeTextFile(
      new URL("readme/README.md", root),
      source.replace(
        "Add the package as a dependency:",
        "Our custom installation instructions:",
      ),
    );
    await runCli(root, ["repo", "features", "--no-jsr-package", "--yes"]);
    assertStringIncludes(
      await read(root, "readme/install.sh"),
      "deno add jsr:@sample/tool",
    );
    assertStringIncludes(
      await read(root, "README.md"),
      "Our custom installation instructions:",
    );
    assert(!(await read(root, "README.md")).includes("[![JSR"));
    assertEquals(await buildReadme(root), await read(root, "README.md"));
  });
  await fixture(async (root) => {
    await enable(root);
    await runCli(root, ["repo", "features", "--no-jsr-package", "--yes"]);
    assertEquals(
      await new LocalFileReader(root).exists("readme/install.sh"),
      false,
    );
    assertEquals(
      await new LocalFileReader(root).exists("readme/example-usage.ts"),
      false,
    );
    assertEquals(await buildReadme(root), await read(root, "README.md"));
  });
});

test("formatted README contributions remain owned after package rename", async () => {
  await fixture(async (root) => {
    await enable(root, "readme-static");
    const formatted = await runCommand("deno", {
      args: ["fmt"],
      cwd: root,
      stdout: "piped",
      stderr: "piped",
    });
    assertEquals(formatted.code, 0, new TextDecoder().decode(formatted.stderr));
    assertStringIncludes(
      await runCli(root, ["repo", "features", "--jsr-package", "--yes"]),
      "No changes.",
    );
    const config = JSON.parse(await read(root, "deno.json"));
    config.name = "@sample/renamed";
    await writeTextFile(
      new URL("deno.json", root),
      JSON.stringify(config),
    );
    await runCli(root, ["repo", "features", "--jsr-package", "--yes"]);
    const output = await read(root, "README.md");
    assert(!output.includes("@sample/tool"), output);
    assertStringIncludes(
      output,
      "deno run --reload jsr:@sample/renamed/example-usage",
    );
    assertStringIncludes(output, 'from "@sample/renamed"');
  });
});

test("unavailable GitHub observations preserve an owned CI badge until explicit disable", async () => {
  await fixture(async (root) => {
    const source = await reconcileBlocks("# Project\n", [{
      id: "github-ci:badge",
      content:
        "[![CI](https://example.invalid/badge.svg)](https://example.invalid/workflow)",
      position: "badges",
    }]);
    await writeTextFile(new URL("README.md", root), source);
    const files = new LocalFileReader(root);
    for (const state of ["enabled", "ambiguous"] as const) {
      const context = {
        repositoryRoot: root,
        files,
        git: new LocalGitReader(root),
        detections: new Map([
          ["readme-static", { state: "enabled" as const, evidence: [] }],
          ["github-ci", { state, evidence: [], issues: [] }],
        ]),
        requestedChanges: [],
        resolvedChanges: [],
        repair: undefined,
        options: {},
      };
      const plans = await reconcileReadmePlans(context, []);
      assertEquals(plans.flatMap((plan) => plan.changes).length, 0);
      const disabled = await reconcileReadmePlans({
        ...context,
        resolvedChanges: [{
          featureId: "github-ci",
          enabled: false,
          reason: { kind: "explicit-request" },
        }],
      }, []);
      const write = disabled.flatMap((plan) => plan.changes)
        .find((change) =>
          change.kind === "write-file" && change.path === "README.md"
        );
      assert(write?.kind === "write-file");
      assertEquals(write.content.includes("github-ci:badge"), false);
    }
    assertEquals(await files.readText("README.md"), source);
  });
});

for (const provider of ["readme-static", "readme-build"]) {
  test(`${provider} migrates legacy API sections to library ownership and removes them from CLI packages`, async () => {
    await fixture(async (root) => {
      await enable(root, provider);
      const path = provider === "readme-build"
        ? "readme/README.md"
        : "README.md";
      const legacy = (await read(root, path)).replace(
        "hj:readme deno-lib:api",
        "hj:readme jsr-package:api",
      );
      await writeTextFile(new URL(path, root), legacy);
      await runCli(root, ["repo", "features", "--deno-lib", "--yes"]);
      const output = await read(root, "README.md");
      assertStringIncludes(output, "hj:readme deno-lib:api");
      assertEquals(output.match(/## API/g)?.length, 1);
      assertEquals(output.includes("hj:readme jsr-package:api"), false);
      await writeTextFile(
        new URL(path, root),
        (await read(root, path)).replace(
          "hj:readme deno-lib:api",
          "hj:readme jsr-package:api",
        ),
      );
      await runCli(root, ["repo", "features", "--no-deno-lib", "--yes"]);
      assertEquals((await read(root, "README.md")).includes("## API"), false);
      await runCli(root, ["repo", "features", "--jsr-package", "--yes"]);
      assertEquals((await read(root, "README.md")).includes("## API"), false);
    });
  });
}

test("customized legacy API sections survive ownership migration", async () => {
  await fixture(async (root) => {
    await enable(root, "readme-static");
    const source = (await read(root, "README.md"))
      .replace("hj:readme deno-lib:api", "hj:readme jsr-package:api")
      .replace(
        "See the API documentation on",
        "Our custom API documentation is on",
      );
    await writeTextFile(new URL("README.md", root), source);
    await runCli(root, ["repo", "features", "--deno-lib", "--yes"]);
    const output = await read(root, "README.md");
    assertStringIncludes(output, "Our custom API documentation is on");
    assertEquals(output.match(/## API/g)?.length, 1);
  });
});
