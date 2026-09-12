import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  makeTempDir,
  mkdir,
  readTextFile,
  remove,
  writeTextFile,
} from "../testing/files-test-fixtures.ts";
import type { OperationContext } from "../api/repository-context.ts";
import { LocalFileReader } from "../repository/local-file-reader.ts";
import { LocalGitReader } from "../repository/local-git-reader.ts";
import { applyLocalChangePlan } from "../operations/local-change-plan.ts";
import { buildReadme } from "../readme/build-readme.ts";
import { reconcileBlocks } from "../readme/contribution-blocks.ts";
import { githubReleasePublishNpmFeature as feature } from "./github-release-publish-feature.ts";
import { npmBadge, npmBadgeOwner } from "./npm-readme-badge.ts";
import { reconcileReadmePlans } from "./readme-contribution-plans.ts";
import { readmeTaskDefinition } from "./deno-tasks.ts";
import { publishNpmArtifact } from "./github-release-publish-artifacts.ts";

const read = (root: URL, path: string) => readTextFile(new URL(path, root));
const write = (root: URL, path: string, text: string) =>
  writeTextFile(new URL(path, root), text);
async function fixture(
  build: boolean,
  run: (root: URL, source: string) => Promise<void>,
) {
  const path = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "npm-badge-",
  });
  const root = new URL(`file://${path}/`);
  try {
    await write(
      root,
      "deno.json",
      JSON.stringify({
        name: "@sample/tool",
        tasks: build ? { readme: readmeTaskDefinition } : {},
      }),
    );
    await mkdir(new URL(".github/workflows", root), { recursive: true });
    if (build) await mkdir(new URL("readme", root));
    const source = build ? "readme/README.md" : "README.md";
    await write(
      root,
      source,
      "# Custom project\n\nKeep every word.\n\n[![CI](https://example.org/badge.svg)](https://example.org)\n\n## Install\n\nCustom installation.\n",
    );
    if (build) await write(root, "README.md", await buildReadme(root));
    await run(root, source);
  } finally {
    await remove(root, { recursive: true });
  }
}
async function context(
  root: URL,
  build: boolean,
  enabled = true,
  repair = false,
): Promise<OperationContext> {
  const basic = {
    repositoryRoot: root,
    files: new LocalFileReader(root),
    git: new LocalGitReader(root),
    github: {
      repository: () => Promise.resolve({ owner: "sample", name: "tool" }),
      resource: () => Promise.resolve(undefined),
      rulesets: () => Promise.resolve(undefined),
      environments: () => Promise.resolve([]),
      variables: () => Promise.resolve([]),
      secretExists: () => Promise.resolve(undefined),
      workflowRuns: () => Promise.resolve([]),
    },
  };
  return {
    ...basic,
    detections: new Map([
      [npmBadgeOwner, await feature.detect(basic)],
      [build ? "readme-build" : "readme-static", {
        state: "enabled" as const,
        evidence: [],
      }],
    ]),
    requestedChanges: [],
    resolvedChanges: [{
      featureId: npmBadgeOwner,
      enabled,
      reason: { kind: "explicit-request" },
    }],
    repair: repair ? { kind: "all-drifted" } : undefined,
    options: {},
  };
}
async function apply(
  root: URL,
  build: boolean,
  enabled = true,
  repair = false,
) {
  const ctx = await context(root, build, enabled, repair);
  const check = await (enabled ? feature.checkEnable : feature.checkDisable)(
    ctx,
  );
  assert(check.result !== "blocked", JSON.stringify(check));
  const plans = check.result === "allowed"
    ? [await (enabled ? feature.planEnable : feature.planDisable)(ctx, check)]
    : [];
  const reconciled = await reconcileReadmePlans(ctx, plans);
  for (const plan of reconciled) await applyLocalChangePlan(root, plan);
  return reconciled.flatMap((plan) => plan.changes);
}
for (const build of [false, true]) {
  test(`npm badge lifecycle preserves custom content and workflow pins with ${build ? "generated" : "static"} README`, async () => {
    await fixture(build, async (root, source) => {
      await apply(root, build);
      let ctx = await context(root, build);
      assertEquals((await feature.detect(ctx)).state, "enabled");
      const first = await read(root, source);
      assertStringIncludes(first, npmBadge("@sample/tool").content);
      assertStringIncludes(first, "Custom installation.");
      assertStringIncludes(first, "[![CI]");
      assertStringIncludes(
        await read(root, "README.md"),
        npmBadge("@sample/tool").content,
      );
      assertEquals((await apply(root, build)).length, 0);
      const workflow = await read(root, publishNpmArtifact.path);
      await write(
        root,
        source,
        await reconcileBlocks(first, [], npmBadgeOwner),
      );
      ctx = await context(root, build);
      const missing = await feature.detect(ctx);
      assertEquals(missing.state, "drifted");
      if (missing.state === "drifted") {
        assertStringIncludes(
          missing.issues[0].resolution,
          "https://www.npmjs.com/package/@sample/tool",
        );
      }
      assertEquals((await feature.checkEnable(ctx)).result, "blocked");
      const repaired = await apply(root, build, true, true);
      assertEquals(
        repaired.some((change) =>
          "path" in change && change.path === publishNpmArtifact.path
        ),
        false,
      );
      assertEquals(await read(root, publishNpmArtifact.path), workflow);
      await write(
        root,
        "deno.json",
        JSON.stringify({
          name: "@sample/renamed",
          tasks: build ? { readme: readmeTaskDefinition } : {},
        }),
      );
      assertEquals(
        (await feature.detect(await context(root, build))).state,
        "drifted",
      );
      await apply(root, build, true, true);
      assertStringIncludes(
        await read(root, "README.md"),
        npmBadge("@sample/renamed").content,
      );
      await apply(root, build, false);
      assertEquals(
        (await feature.detect(await context(root, build))).state,
        "disabled",
      );
      assertEquals(
        (await read(root, source)).includes("img.shields.io/npm/v/"),
        false,
      );
      assertStringIncludes(await read(root, source), "Custom installation.");
      assertStringIncludes(await read(root, source), "[![CI]");
      assertEquals((await apply(root, build, false)).length, 0);
    });
  });
  test(`npm badge custom, duplicate and unavailable identity safeguards with ${build ? "generated" : "static"} README`, async () => {
    await fixture(build, async (root, source) => {
      await apply(root, build);
      const original = await read(root, source);
      for (
        const text of [
          original.replace("[![npm Version]", "[![Edited npm]"),
          original + original,
          original +
          `\n<!-- hj:readme ${npmBadgeOwner}:badge not-a-hash -->\ncustom\n<!-- /hj:readme -->\n`,
          original.replace(
            "https://www.npmjs.com/package/@sample/tool",
            "https://www.npmjs.com/package/@other/wrong",
          ),
        ]
      ) {
        await write(root, source, text);
        const ctx = await context(root, build, true, true);
        assertEquals((await feature.detect(ctx)).state, "ambiguous");
        assertEquals((await feature.checkEnable(ctx)).result, "blocked");
        const plans = await reconcileReadmePlans({
          ...ctx,
          resolvedChanges: [],
        }, []);
        assertEquals(
          plans.flatMap((plan) => plan.changes).some((change) =>
            "path" in change && change.path === source
          ),
          false,
        );
        assertEquals(await read(root, source), text);
      }
      await write(root, source, original);
      const config = await read(root, "deno.json");
      for (const name of [undefined, "unscoped", "@invalid/name?query"]) {
        await write(
          root,
          "deno.json",
          JSON.stringify({ ...JSON.parse(config), name }),
        );
        assertEquals(
          (await feature.detect(await context(root, build))).state,
          "ambiguous",
        );
        assertEquals(
          (await feature.checkEnable(await context(root, build))).result,
          "blocked",
        );
      }
      await write(root, "deno.json", config);
      await write(root, "deno.jsonc", config);
      assertEquals(
        (await feature.detect(await context(root, build))).state,
        "ambiguous",
      );
      await remove(new URL("deno.jsonc", root));
      await write(
        root,
        source,
        original.replace("[![npm Version]", "[![My npm]"),
      );
      await apply(root, build, false);
      assertStringIncludes(await read(root, source), "[![My npm]");
      assertEquals(
        (await feature.detect(await context(root, build))).state,
        "disabled",
      );
    });
  });
  test(`npm badge respects matching unowned badges and rejects conflicting ones with ${build ? "generated" : "static"} README`, async () => {
    await fixture(build, async (root, source) => {
      const custom = (await read(root, source)) + "\n" +
        npmBadge("@sample/tool").content + "\n";
      await write(root, source, custom);
      await apply(root, build);
      assertEquals(await read(root, source), custom);
      await apply(root, build, false);
      assertEquals(await read(root, source), custom);
      await write(
        root,
        source,
        custom.replaceAll("@sample/tool", "@other/wrong"),
      );
      assertEquals(
        (await feature.checkEnable(await context(root, build))).result,
        "blocked",
      );
      await write(
        root,
        source,
        "# Custom\n\n[![npm](https://example.com/badge.svg)](https://example.com/package)\n",
      );
      const mismatched = await context(root, build, true, true);
      assertEquals((await feature.checkEnable(mismatched)).result, "blocked");
    });
  });
}
