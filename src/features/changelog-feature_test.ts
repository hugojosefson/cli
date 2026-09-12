import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import {
  makeTempDir,
  mkdir,
  remove,
  writeTextFile,
} from "../testing/files-test-fixtures.ts";
import type { OperationContext } from "../api/repository-context.ts";
import { applyLocalChangePlan } from "../operations/local-change-plan.ts";
import { LocalFileReader } from "../repository/local-file-reader.ts";
import {
  changelogFeature as feature,
  changelogStarter,
} from "./changelog-feature.ts";
import { githubReleasePublishTagFeature } from "./github-release-publish-feature.ts";

test("changelog independent lifecycle creates only an empty starter and removes it", async () => {
  await repository(async (context) => {
    assertEquals(feature.dependencies.requires, []);
    assertEquals((await feature.detect(context)).state, "disabled");
    const enable = await feature.checkEnable(context);
    assert(enable.result === "allowed");
    const plan = await feature.planEnable(context, enable);
    assertEquals(plan.changes, [{
      kind: "write-file",
      path: "CHANGELOG.md",
      content: changelogStarter,
      expectedDigest: undefined,
    }]);
    await applyLocalChangePlan(context.repositoryRoot, plan);
    assertEquals(
      await context.files.readText("CHANGELOG.md"),
      changelogStarter,
    );
    assertEquals((await feature.detect(context)).state, "enabled");
    assertEquals((await feature.checkEnable(context)).result, "no-op");
    const disable = await feature.checkDisable(context);
    assert(disable.result === "allowed");
    await applyLocalChangePlan(
      context.repositoryRoot,
      await feature.planDisable(context, disable),
    );
    assertEquals((await feature.detect(context)).state, "disabled");
    assertEquals((await feature.checkDisable(context)).result, "no-op");
  });
  assert(
    githubReleasePublishTagFeature.dependencies.requires.some((item) =>
      item.featureId === "changelog"
    ),
  );
});

test("changelog accepts flat, mixed and custom history and only offers relevant migration previews", async () => {
  await repository(async (context) => {
    const cases = [
      ["# Changelog\n\n## 1.0.0\n\n- feat(cli): old\n", "flat entries", true],
      [
        "# Changelog\n\n## 2.0.0\n\n### Fixes\n\n- new\n\n## 1.0.0\n\n- feat: old\n",
        "mixed flat and grouped",
        true,
      ],
      [
        "# Changelog\n\n## 1.0.0\n\n### Features\n\n- grouped\n",
        "grouped release sections",
        false,
      ],
      [
        "# Changes\n\nCustom   history\n\n```md\n- feat: example\n```\n",
        "custom content",
        false,
      ],
      ["# Release journal\n\n- feat: example\n", "custom content", false],
      ["", "custom content", false],
    ] as const;
    for (const [content, evidence, migration] of cases) {
      await writeTextFile(
        new URL("CHANGELOG.md", context.repositoryRoot),
        content,
      );
      const state = await feature.detect(context);
      assertEquals(state.state, "enabled");
      const output = state.evidence.map((item) => item.observation).join("\n");
      assertStringIncludes(output, evidence);
      assertEquals(output.includes("hj changelog migrate"), migration);
      assertEquals(output.includes("repair"), false);
      assertEquals((await feature.checkEnable(context)).result, "no-op");
      const disable = await feature.checkDisable(context);
      assertEquals(disable.result, "blocked");
      if (disable.result === "blocked") {
        assertStringIncludes(
          disable.blockers[0].resolution,
          "archive its contents",
        );
      }
      assertEquals(await context.files.readText("CHANGELOG.md"), content);
    }
  });
});

test("changelog reports nonregular paths with a specific manual action", async () => {
  await repository(async (context) => {
    await mkdir(new URL("CHANGELOG.md", context.repositoryRoot));
    const state = await feature.detect(context);
    assertEquals(state.state, "ambiguous");
    if (state.state === "ambiguous") {
      assertStringIncludes(
        state.issues[0].resolution,
        "Make CHANGELOG.md a readable regular file",
      );
    }
    assertEquals((await feature.checkEnable(context)).result, "blocked");
    assertEquals((await feature.checkDisable(context)).result, "blocked");
  });
});

test("changelog plans reject stale creation and protect later history", async () => {
  await repository(async (context) => {
    const check = await feature.checkEnable(context);
    assert(check.result === "allowed");
    const plan = await feature.planEnable(context, check);
    await writeTextFile(
      new URL("CHANGELOG.md", context.repositoryRoot),
      "new user history\n",
    );
    await assertRejects(() =>
      applyLocalChangePlan(context.repositoryRoot, plan)
    );
    await assertRejects(
      () => feature.planEnable(context, check),
      Error,
      "no longer matches",
    );
    await writeTextFile(
      new URL("CHANGELOG.md", context.repositoryRoot),
      changelogStarter,
    );
    const disable = await feature.checkDisable(context);
    assert(disable.result === "allowed");
    const deletion = await feature.planDisable(context, disable);
    await writeTextFile(
      new URL("CHANGELOG.md", context.repositoryRoot),
      "new release history\n",
    );
    await assertRejects(() =>
      applyLocalChangePlan(context.repositoryRoot, deletion)
    );
  });
});

async function repository(
  action: (context: OperationContext) => Promise<void>,
): Promise<void> {
  const path = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-changelog-feature-",
  });
  const root = new URL(`file://${path}/`);
  const unused = () => {
    throw new Error("Changelog inspection must not access Git");
  };
  try {
    await action({
      repositoryRoot: root,
      files: new LocalFileReader(root),
      git: {
        isRepository: unused,
        head: unused,
        status: unused,
        remotes: unused,
        defaultBranch: unused,
      },
      detections: new Map(),
      requestedChanges: [],
      resolvedChanges: [],
      repair: undefined,
      options: {},
    });
  } finally {
    await remove(root, { recursive: true });
  }
}
