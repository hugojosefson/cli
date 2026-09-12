import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { preflightLocalChangePlan } from "../operations/local-change-plan.ts";
import type { OperationContext } from "../api/repository-context.ts";
import { runFeatureOperation } from "../cli/run-features.ts";
import { parseFeatures } from "../cli/parse-features.ts";
import { denoFmtFeature } from "./deno-fmt-feature.ts";
import { readmeBuildFeature } from "./readme-build-feature.ts";
import { denoTaskDefinitions, readmeTaskDefinition } from "./deno-tasks.ts";
import type { FeatureRegistry } from "./feature-registry.ts";
import type { DetectionContext } from "../api/repository-context.ts";
import { LocalGitReader } from "../repository/local-git-reader.ts";
import { LocalFileReader } from "../repository/local-file-reader.ts";
import { legacyReadmeGenerator } from "./legacy-readme-test-fixtures.ts";
import {
  convertLegacyIncludes,
  inspectLegacyReadme,
  legacyAllTask,
  legacyDefaultTask,
  legacyReadmeTask,
} from "./legacy-readme.ts";

Deno.test("legacy README includes preserve custom prose and reject unknown quoted paths", () => {
  assertEquals(
    convertLegacyIncludes(
      'Edited prose\n"@@include(./install.sh)";\n"@@include(./example-usage.ts)";\n',
    ),
    "Edited prose\n@@include(./install.sh)\n@@include(./example-usage.ts)\n",
  );
  assertEquals(convertLegacyIncludes('"@@include(./custom.ts)";\n'), undefined);
  assertEquals(
    convertLegacyIncludes('Example: "@@include(./install.sh)";\n'),
    'Example: "@@include(./install.sh)";\n',
  );
});

Deno.test("legacy README recognizes the generator and builds edited inputs without mutation", async () => {
  await fixture(async (root, context) => {
    const before = await context.files.observe("readme/README.md");
    const state = await inspectLegacyReadme(
      context,
      `    ${legacyReadmeTask}`,
      before,
    );
    assertEquals(state.kind, "recognized");
    if (state.kind !== "recognized") {
      throw new Error("migration not recognized");
    }
    assertStringIncludes(state.output, "Edited instructions stay.");
    assertStringIncludes(state.output, "deno add jsr:@custom/package");
    assertStringIncludes(
      state.output,
      'import { custom } from "@legacy-scope/legacy-package";',
    );
    assertStringIncludes(state.output, "console.log(custom(42));");
    assertEquals(await context.files.observe("readme/README.md"), before);
    assertEquals(await context.files.exists("README.md"), false);
    assertStringIncludes(
      await Deno.readTextFile(new URL("deno.json", root)),
      '"./example-usage": "./public-example.ts"',
    );
  });
});

Deno.test("legacy README rejects edited generators and unsafe include files", async () => {
  await fixture(async (root, context) => {
    const source = await context.files.observe("readme/README.md");
    await Deno.writeTextFile(
      new URL("readme/generate-readme.ts", root),
      legacyReadmeGenerator + "\n// custom behavior\n",
    );
    assertEquals(
      (await inspectLegacyReadme(context, legacyReadmeTask, source)).kind,
      "conflict",
    );
    await Deno.writeTextFile(
      new URL("readme/generate-readme.ts", root),
      legacyReadmeGenerator,
    );
    await Deno.remove(new URL("readme/install.sh", root));
    await Deno.mkdir(new URL("readme/install.sh", root));
    assertEquals(
      (await inspectLegacyReadme(context, legacyReadmeTask, source)).kind,
      "conflict",
    );
    assertEquals(
      (await inspectLegacyReadme(context, "custom generator", source)).kind,
      "absent",
    );
  });
});

Deno.test("legacy README migration previews changes, replaces tasks, and preserves sources", async () => {
  await fixture(async (root, context) => {
    const registry: FeatureRegistry = {
      features: [denoFmtFeature, readmeBuildFeature],
      capabilities: [{
        id: "readme",
        providerPolicy: "exclusive",
        defaultProvider: "readme-build",
      }],
    };
    const configPath = new URL("deno.json", root);
    const config = JSON.parse(await Deno.readTextFile(configPath));
    config.tasks = {
      default: legacyDefaultTask,
      all: legacyAllTask,
      readme: legacyReadmeTask,
    };
    await Deno.writeTextFile(configPath, JSON.stringify(config, null, 2));
    await Deno.writeTextFile(new URL("README.md", root), "# Previous output\n");
    await Deno.chmod(new URL("README.md", root), 0o444);
    const flags = [
      "repo",
      "features",
      "--readme-build",
      "--deno-fmt",
      "--repair",
    ];
    const run = (...extra: string[]) =>
      runFeatureOperation(
        root,
        parseFeatures([...flags, ...extra], registry),
        registry,
        undefined,
        { runFinalTask: () => Promise.resolve(undefined) },
      );
    const beforeSource = await context.files.readText("readme/README.md");
    const beforeInstall = await context.files.readText("readme/install.sh");
    const beforeExample = await context.files.readText(
      "readme/example-usage.ts",
    );
    const error = await assertRejects(
      () => run(),
      Error,
      "confirmation required",
    );
    assertStringIncludes(
      error.message,
      "--- README.md before\n# Previous output",
    );
    assertStringIncludes(error.message, "+++ README.md after\n# Legacy");
    assertStringIncludes(error.message, "console.log(custom(42));");
    assertEquals(
      await context.files.readText("readme/README.md"),
      beforeSource,
    );
    await run("--yes");
    const after = JSON.parse(await Deno.readTextFile(configPath));
    assertEquals(after.tasks.readme, readmeTaskDefinition);
    assertEquals(after.tasks.default, denoTaskDefinitions([], true).default);
    assertEquals(after.exports, config.exports);
    assertEquals(await context.files.mode("README.md"), 0o444);
    assertEquals(
      await context.files.readText("readme/install.sh"),
      beforeInstall,
    );
    assertEquals(
      await context.files.readText("readme/example-usage.ts"),
      beforeExample,
    );
    assertStringIncludes(
      (await context.files.readText("readme/README.md"))!,
      "@@include(./install.sh)",
    );
    assertEquals(
      await context.files.readText("readme/generate-readme.ts"),
      legacyReadmeGenerator,
    );
    assertEquals((await readmeBuildFeature.detect(context)).state, "enabled");
    const afterSource = await context.files.readText("readme/README.md");
    await run("--yes");
    assertEquals(await context.files.readText("readme/README.md"), afterSource);
  });
});

Deno.test("legacy README plan rejects source changes after preview", async () => {
  await fixture(async (root, context) => {
    const configPath = new URL("deno.json", root);
    const config = JSON.parse(await Deno.readTextFile(configPath));
    config.tasks = { ...denoTaskDefinitions(), readme: legacyReadmeTask };
    await Deno.writeTextFile(configPath, JSON.stringify(config));
    const operation: OperationContext = {
      ...context,
      detections: new Map(),
      requestedChanges: [],
      resolvedChanges: [],
      repair: { kind: "all-drifted" },
      options: {},
    };
    const check = await readmeBuildFeature.checkEnable(operation);
    assertEquals(check.result, "allowed");
    if (check.result !== "allowed") throw new Error("migration not allowed");
    const plan = await readmeBuildFeature.planEnable(operation, check);
    assertStringIncludes(plan.summary, "Replace tasks.readme:");
    assertStringIncludes(plan.summary, "+++ README.md after");
    await preflightLocalChangePlan(root, plan);
    await Deno.writeTextFile(
      new URL("readme/example-usage.ts", root),
      "new user edit\n",
    );
    await assertRejects(
      () => preflightLocalChangePlan(root, plan),
      Error,
      "directory-state",
    );
    assertEquals(await context.files.exists("README.md"), false);
  });
});

Deno.test("legacy README replaces its task when formatting is already configured", async () => {
  await fixture(async (root, context) => {
    const registry: FeatureRegistry = {
      features: [denoFmtFeature, readmeBuildFeature],
      capabilities: [{
        id: "readme",
        providerPolicy: "exclusive",
        defaultProvider: "readme-build",
      }],
    };
    const configPath = new URL("deno.json", root);
    const config = JSON.parse(await Deno.readTextFile(configPath));
    config.tasks = { ...denoTaskDefinitions(), readme: legacyReadmeTask };
    await Deno.writeTextFile(configPath, JSON.stringify(config));
    await runFeatureOperation(
      root,
      parseFeatures([
        "repo",
        "features",
        "--readme-build",
        "--deno-fmt",
        "--repair",
        "--yes",
      ], registry),
      registry,
      undefined,
      { runFinalTask: () => Promise.resolve(undefined) },
    );
    assertEquals((await readmeBuildFeature.detect(context)).state, "enabled");
  });
});

async function fixture(
  run: (root: URL, context: DetectionContext) => Promise<void>,
) {
  const path = await Deno.makeTempDir({
    dir: "/tmp/opencode",
    prefix: "legacy-readme-",
  });
  const root = new URL(`file://${path}/`);
  try {
    await Deno.mkdir(new URL("readme", root));
    await Deno.writeTextFile(
      new URL("deno.json", root),
      JSON.stringify(
        {
          name: "@legacy-scope/legacy-package",
          exports: {
            ".": "./mod.ts",
            "./example-usage": "./public-example.ts",
          },
        },
        null,
        2,
      ),
    );
    await Deno.writeTextFile(
      new URL("readme/generate-readme.ts", root),
      legacyReadmeGenerator,
    );
    await Deno.writeTextFile(
      new URL("readme/README.md", root),
      '# Legacy\nEdited instructions stay.\n```sh\n"@@include(./install.sh)";\n```\n```ts\n"@@include(./example-usage.ts)";\n```\n',
    );
    await Deno.writeTextFile(
      new URL("readme/install.sh", root),
      "#!/bin/sh\ndeno add jsr:@custom/package\n",
    );
    await Deno.writeTextFile(
      new URL("readme/example-usage.ts", root),
      '#!/usr/bin/env -S deno run\nimport { custom } from "../mod.ts";\nconsole.log(custom(42));\n',
    );
    const context = {
      repositoryRoot: root,
      files: new LocalFileReader(root),
      git: new LocalGitReader(root),
    } as DetectionContext;
    await run(root, context);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}
