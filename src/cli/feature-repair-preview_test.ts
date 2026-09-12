import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import type { ChangePlan } from "../api/change-plan.ts";
import type { FeatureDetection } from "../api/feature-detection.ts";
import type { Feature } from "../api/feature.ts";
import type { OperationContext } from "../api/repository-context.ts";
import { denoFmtFeature } from "../features/deno-fmt-feature.ts";
import { denoTaskDefinitions } from "../features/deno-tasks.ts";
import { gitIgnoreFeature } from "../features/git-ignore-feature.ts";
import { gitIgnoreContent } from "../features/git-ignore-content.ts";
import { readmeStaticFeature } from "../features/readme-static-feature.ts";
import { gitFeature } from "../features/git-feature.ts";
import { LocalFileReader } from "../repository/local-file-reader.ts";
import { LocalGitReader } from "../repository/local-git-reader.ts";
import {
  featureRepairPreviews,
  repairStateDescription,
} from "./feature-repair-preview.ts";
import { parseFeatures } from "./parse-features.ts";
import { runFeatureOperation } from "./run-features.ts";
import { repairCompletionDescription } from "./repair-completion-description.ts";

const drifted: FeatureDetection = {
  state: "drifted",
  evidence: [],
  issues: [],
};
const disabled: FeatureDetection = { state: "disabled", evidence: [] };

Deno.test("git-ignore status accepts a custom suffix and names only missing exclusion lines", async () => {
  await repository(async (context) => {
    const root = context.repositoryRoot;
    const registry = { features: [gitIgnoreFeature], capabilities: [] };
    await Deno.writeTextFile(
      new URL("deno.json", root),
      JSON.stringify({ tasks: { test: "deno test --coverage=coverage" } }),
    );
    const suffix = "# Custom suffix\nprivate.log\n";
    const complete =
      gitIgnoreContent("# Custom prefix\n", [".*.swp", "/coverage/"]) + suffix;
    await Deno.writeTextFile(new URL(".gitignore", root), complete);
    const run = (...flags: string[]) =>
      runFeatureOperation(
        root,
        parseFeatures(["repo", "features", ...flags], registry),
        registry,
      );
    const clean = await run();
    assertStringIncludes(clean.replace(/ +/g, " "), "git-ignore enabled");
    assert(!clean.includes("Repair:"));
    assert(!clean.includes("Reorder"));
    assertStringIncludes(await run("--repair"), "No changes.");
    assertEquals(await context.files.readText(".gitignore"), complete);
    const missing = complete.replace(
      "# hj:git-ignore /coverage/\n/coverage/\n",
      "",
    );
    await Deno.writeTextFile(new URL(".gitignore", root), missing);
    const preview = await run();
    assertStringIncludes(preview.replace(/ +/g, " "), "git-ignore drifted");
    assertStringIncludes(
      preview,
      "Add .gitignore line 7: # hj:git-ignore /coverage/",
    );
    assertStringIncludes(preview, "Add .gitignore line 8: /coverage/");
    assert(!preview.includes("Remove .gitignore"));
    assert(!preview.includes("Reorder"));
    assertEquals(await context.files.readText(".gitignore"), missing);
    await run("--repair", "--git-ignore", "--yes");
    assertEquals(
      await context.files.readText(".gitignore"),
      missing + "# hj:git-ignore /coverage/\n/coverage/\n",
    );
    assert(!(await run()).includes("Repair:"));
    await Deno.remove(new URL(".gitignore", root));
    const disabledRepair = await run("--repair");
    assertStringIncludes(
      disabledRepair.replace(/ +/g, " "),
      "git-ignore disabled",
    );
    assert(!disabledRepair.includes("Repair:"));
    assertStringIncludes(disabledRepair, "No changes.");
    assertEquals(await context.files.exists(".gitignore"), false);
    await run("--repair", "--git-ignore", "--yes");
    assertEquals((await gitIgnoreFeature.detect(context)).state, "enabled");
  });
});

Deno.test("repair completion describes managed locks and final tasks without touching either", async () => {
  await repository(async (context) => {
    const config = { lock: true, tasks: { default: "deno task check" } };
    await Deno.writeTextFile(
      new URL("deno.json", context.repositoryRoot),
      JSON.stringify(config),
    );
    const plan: ChangePlan = {
      featureId: "deno-cli",
      action: "enable",
      summary: "Repair CLI",
      warnings: [],
      preconditions: [],
      validations: [],
      changes: [{
        kind: "write-file",
        path: ".hj/deno-lock.json",
        content: JSON.stringify({
          version: 1,
          configPath: "deno.json",
          lock: true,
        }),
        expectedDigest: undefined,
      }],
    };
    const details = (await repairCompletionDescription(context, [plan])).join(
      "\n",
    );
    assertStringIncludes(details, "Generate or refresh deno.lock");
    assertStringIncludes(details, "deno task --config deno.json default");
    assertEquals(await context.files.exists("deno.lock"), false);
    assertEquals(await context.files.exists(".hj"), false);
    await Deno.writeTextFile(
      new URL("deno.lock", context.repositoryRoot),
      "custom lock",
    );
    assert(
      !(await repairCompletionDescription(context, [plan])).join("\n").includes(
        "Generate or refresh",
      ),
    );
    assertEquals(
      await repairCompletionDescription(context, [{ ...plan, changes: [] }]),
      [],
    );
    const withGit = {
      ...context,
      git: {
        ...context.git,
        isRepository: () => Promise.resolve(true),
        head: () => Promise.resolve(undefined),
        status: () => Promise.resolve(undefined),
        remotes: () => Promise.resolve([]),
        defaultBranch: () => Promise.resolve("main"),
      },
    };
    assertStringIncludes(
      (await repairCompletionDescription(withGit, [plan])).join("\n"),
      "Commit the changed feature files",
    );
  });
});

Deno.test("status previews the real formatting repair and shared files without changing the repository", async () => {
  await repository(async (context) => {
    const root = context.repositoryRoot;
    const registry = {
      features: [denoFmtFeature, gitIgnoreFeature, readmeStaticFeature],
      capabilities: [{
        id: "readme",
        providerPolicy: "exclusive" as const,
        defaultProvider: "readme-static",
      }],
    };
    const custom = "deno eval 'const preservedCredential = 123'";
    const config = {
      tasks: {
        ...denoTaskDefinitions(),
        fmt: { command: "prettier --write ." },
        custom,
      },
    };
    await Deno.writeTextFile(
      new URL("deno.json", root),
      JSON.stringify(config),
    );
    const ignore = gitIgnoreContent("# user exclusions\nprivate.log\n", []);
    await Deno.writeTextFile(new URL(".gitignore", root), ignore);
    await Deno.writeTextFile(new URL("README.md", root), "# Custom project\n");
    let taskCalls = 0;
    const run = (...flags: string[]) =>
      runFeatureOperation(
        root,
        parseFeatures(["repo", "features", ...flags], registry),
        registry,
        () => {
          throw new Error("status must not prompt");
        },
        {
          runFinalTask: () => {
            taskCalls++;
            return Promise.resolve(undefined);
          },
          promptAttribution: () => {
            throw new Error("status must not prompt for attribution");
          },
          promptJsrScope: () => {
            throw new Error("status must not prompt for scope");
          },
        },
      );
    const status = await run();
    assertStringIncludes(status, "Repair (--repair --deno-fmt)");
    assertStringIncludes(status, "tasks.fmt.command");
    assertStringIncludes(status, '"deno fmt --ignore=coverage"');
    assertStringIncludes(status, "replace existing value");
    assertStringIncludes(status, ".gitignore");
    assertStringIncludes(status, ".hj/deno-lock.json");
    assert(!status.includes(custom));
    assertEquals(taskCalls, 0);
    assertEquals(
      await context.files.readText("deno.json"),
      JSON.stringify(config),
    );
    assertEquals(await context.files.readText(".gitignore"), ignore);
    assertEquals(await context.files.exists(".hj"), false);
    const repaired = await run("--repair", "--deno-fmt", "--yes");
    assertEquals(taskCalls, 1);
    assertStringIncludes(repaired.replace(/ +/g, " "), "deno-fmt enabled");
    assert(!repaired.includes("Repair:"));
    const final = JSON.parse((await context.files.readText("deno.json"))!);
    assertEquals(final.tasks.fmt, denoTaskDefinitions().fmt);
    assertEquals(final.tasks.custom, custom);
    assertStringIncludes(
      (await context.files.readText(".gitignore"))!,
      "private.log",
    );
    assertEquals((await gitIgnoreFeature.detect(context)).state, "enabled");
    assertEquals(await context.files.exists(".hj/deno-lock.json"), true);
  });
});

Deno.test("repair preview resolves missing dependencies and reports ambiguous dependencies without plans", async () => {
  await repository(async (context) => {
    let planned = 0;
    const dependency = feature("dependency", []);
    const consumer = feature("consumer", [{
      kind: "write-file",
      path: "consumer.txt",
      content: "generated",
      expectedDigest: undefined,
    }]);
    const dependent: Feature = {
      ...consumer,
      dependencies: {
        requires: [{ featureId: "dependency", reason: "required" }],
      },
      planEnable: (context, allowed) => {
        planned++;
        return consumer.planEnable(context, allowed);
      },
    };
    const registry = { features: [dependency, dependent], capabilities: [] };
    const previews = await featureRepairPreviews({
      ...context,
      detections: new Map<string, FeatureDetection>([["consumer", drifted], [
        "dependency",
        disabled,
      ]]),
    }, registry);
    assertStringIncludes(previews.get("consumer")!, "Create consumer.txt");
    assertEquals(previews.has("dependency"), false);
    assertEquals(planned, 1);
    assertEquals(await context.files.exists("consumer.txt"), false);
    const blocked = await featureRepairPreviews({
      ...context,
      detections: new Map<string, FeatureDetection>([["consumer", drifted], [
        "dependency",
        {
          state: "ambiguous",
          evidence: [],
          issues: [],
        },
      ]]),
    }, registry);
    assertStringIncludes(
      blocked.get("consumer")!,
      "ambiguous-feature: dependency",
    );
    assertEquals(planned, 1);
  });
});

Deno.test("repair previews preserve manual blockers and do not leak unexpected planner errors", async () => {
  await repository(async (context) => {
    const template = feature("example", []);
    const cases: readonly [Feature, string][] = [
      [{
        ...template,
        checkEnable: () =>
          Promise.resolve({
            result: "blocked",
            warnings: [],
            blockers: [{
              code: "custom",
              message: "LICENSE contains custom terms.",
              subjects: [],
              resolution: "Restore the intended LICENSE text manually.",
            }],
          }),
      }, "Restore the intended LICENSE"],
      [{
        ...template,
        checkEnable: () =>
          Promise.resolve({
            result: "no-op",
            reason: "The artifact is already configured.",
            warnings: [],
          }),
      }, "already configured"],
      [template, "Repair makes no changes"],
      [{
        ...template,
        planEnable: () => {
          throw new Error("credential=never-print-this");
        },
      }, "Repair preview is unavailable"],
    ];
    for (const [selected, expected] of cases) {
      const result = await featureRepairPreviews({
        ...context,
        detections: new Map([["example", drifted]]),
      }, { features: [selected], capabilities: [] });
      assertStringIncludes(result.get("example")!, expected);
      assert(!result.get("example")!.includes("never-print-this"));
    }
    assertEquals(
      repairStateDescription({ state: "enabled", evidence: [] }),
      undefined,
    );
    assertEquals(repairStateDescription(disabled), undefined);
    assertStringIncludes(repairStateDescription()!, "could not be determined");
    assertStringIncludes(
      repairStateDescription({
        state: "ambiguous",
        evidence: [],
        issues: [{
          code: "custom",
          kind: "file",
          subject: { kind: "file", identifier: "README.md" },
          observation: "Conflicting README providers",
          resolution: "Choose one README provider.",
        }],
      })!,
      "README.md: Choose one README provider",
    );
  });
});

function feature(id: string, changes: ChangePlan["changes"]): Feature {
  return {
    ...gitFeature,
    metadata: { id, name: id, summary: id },
    detect: () => Promise.resolve(drifted),
    checkEnable: () =>
      Promise.resolve({ result: "allowed", warnings: [], preconditions: [] }),
    planEnable: () =>
      Promise.resolve({
        featureId: id,
        action: "enable",
        summary: `Repair ${id}.`,
        warnings: [],
        preconditions: [],
        changes,
        validations: [],
      }),
  };
}

async function repository(
  action: (context: OperationContext) => Promise<void>,
): Promise<void> {
  const path = await Deno.makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-repair-preview-",
  });
  const root = new URL(`file://${path}/`);
  try {
    await action({
      repositoryRoot: root,
      files: new LocalFileReader(root),
      git: new LocalGitReader(root),
      detections: new Map(),
      requestedChanges: [],
      resolvedChanges: [],
      repair: undefined,
      options: {},
    });
  } finally {
    await Deno.remove(path, { recursive: true });
  }
}
