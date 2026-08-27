import { assert, assertEquals } from "@std/assert";
import type { OperationContext } from "../api/repository-context.ts";
import { applyLocalChangePlan } from "../operations/local-change-plan.ts";
import { LocalFileReader } from "../repository/local-file-reader.ts";
import { denoCliFeature } from "./deno-cli-feature.ts";
import { denoServerArtifacts } from "./deno-server-artifacts.ts";
import { denoServerFeature } from "./deno-server-feature.ts";

Deno.test("deno-server creates dependency-free seeds and smoke test", async () => {
  assertEquals(denoServerArtifacts.map((item) => item.path), [
    "src/server/server.ts",
    "src/server/serve-command.ts",
    "test/server_test.ts",
  ]);
  await withRepository(async (root) => {
    await enable(root, denoServerFeature);
    assertEquals(
      (await denoServerFeature.detect(context(root))).state,
      "enabled",
    );
    const result = await new Deno.Command("deno", {
      args: ["test", "test/server_test.ts"],
      cwd: root.pathname,
    }).output();
    assert(result.success, new TextDecoder().decode(result.stderr));
    const disable = await denoServerFeature.checkDisable(context(root));
    if (disable.result !== "allowed") {
      throw new Error("test setup requires disable");
    }
    await applyLocalChangePlan(
      root,
      await denoServerFeature.planDisable(context(root), disable),
    );
    assertEquals(
      (await denoServerFeature.detect(context(root))).state,
      "disabled",
    );
    for (const artifact of denoServerArtifacts) {
      assert((await Deno.stat(new URL(artifact.path, root))).isFile);
    }
  });
});

Deno.test("deno-server composes the exact CLI registry", async () => {
  await withRepository(async (root) => {
    await enable(root, denoCliFeature);
    const changes = [{
      featureId: "deno-server",
      enabled: true,
      reason: { kind: "explicit-request" as const },
    }];
    await enable(root, denoServerFeature, changes);
    assert(
      (await Deno.readTextFile(new URL("src/cli/commands.ts", root))).includes(
        "serveCommand",
      ),
    );
    assertEquals((await denoCliFeature.detect(context(root))).state, "enabled");
    const disable = await denoServerFeature.checkDisable(
      context(root, changes),
    );
    if (disable.result !== "allowed") {
      throw new Error("test setup requires disable");
    }
    await applyLocalChangePlan(
      root,
      await denoServerFeature.planDisable(context(root, changes), disable),
    );
    assertEquals((await denoCliFeature.detect(context(root))).state, "enabled");
  });
});

Deno.test("deno-server repairs selected content and mode drift", async () => {
  await withRepository(async (root) => {
    await enable(root, denoServerFeature);
    await Deno.writeTextFile(new URL("src/server/server.ts", root), "edited\n");
    await Deno.chmod(new URL("src/server/serve-command.ts", root), 0o755);
    assertEquals(
      (await denoServerFeature.detect(context(root))).state,
      "drifted",
    );
    assertEquals(
      (await denoServerFeature.checkEnable(context(root))).result,
      "blocked",
    );
    const repair = { kind: "features" as const, featureIds: ["deno-server"] };
    const current = context(root, [], repair);
    const check = await denoServerFeature.checkEnable(current);
    if (check.result !== "allowed") {
      throw new Error("test setup requires repair");
    }
    await applyLocalChangePlan(
      root,
      await denoServerFeature.planEnable(current, check),
    );
    for (const artifact of denoServerArtifacts) {
      assertEquals(
        await Deno.readTextFile(new URL(artifact.path, root)),
        artifact.content,
      );
      assertEquals(
        (await Deno.stat(new URL(artifact.path, root))).mode! & 0o777,
        0o644,
      );
    }
  });
});

Deno.test("deno-server blocks export, path, and CLI registry conflicts", async () => {
  await withRepository(async (root) => {
    await Deno.writeTextFile(
      new URL("deno.jsonc", root),
      '{ "exports": { "./server": "./other.ts" } }\n',
    );
    assertEquals(
      (await denoServerFeature.checkEnable(context(root))).result,
      "blocked",
    );
    assertEquals(
      (await denoServerFeature.checkDisable(context(root))).result,
      "blocked",
    );
  });
  await withRepository(async (root) => {
    await Deno.writeTextFile(new URL("deno.json", root), "{}\n");
    await Deno.writeTextFile(new URL("deno.jsonc", root), "{}\n");
    assertEquals(
      (await denoServerFeature.checkEnable(context(root))).result,
      "blocked",
    );
  });
  await withRepository(async (root) => {
    await Deno.mkdir(new URL("src", root));
    await Deno.writeTextFile(new URL("src/server", root), "conflict\n");
    assertEquals(
      (await denoServerFeature.checkEnable(context(root))).result,
      "blocked",
    );
  });
  await withRepository(async (root) => {
    await enable(root, denoCliFeature);
    await enable(root, denoServerFeature, [{
      featureId: "deno-server",
      enabled: true,
      reason: { kind: "explicit-request" },
    }]);
    await Deno.writeTextFile(new URL("src/cli/commands.ts", root), "edited\n");
    assertEquals(
      (await denoServerFeature.checkEnable(context(root))).result,
      "blocked",
    );
    assertEquals(
      (await denoServerFeature.checkDisable(context(root))).result,
      "blocked",
    );
  });
});

async function enable(
  root: URL,
  feature: typeof denoServerFeature,
  changes: OperationContext["resolvedChanges"] = [],
) {
  const current = context(root, changes);
  const check = await feature.checkEnable(current);
  if (check.result !== "allowed") throw new Error("test setup requires enable");
  await applyLocalChangePlan(root, await feature.planEnable(current, check));
}

function context(
  root: URL,
  resolvedChanges: OperationContext["resolvedChanges"] = [],
  repair: OperationContext["repair"] = undefined,
): OperationContext {
  return {
    repositoryRoot: root,
    files: new LocalFileReader(root),
    git: {
      isRepository: () => Promise.reject(),
      head: () => Promise.reject(),
      status: () => Promise.reject(),
      remotes: () => Promise.reject(),
      defaultBranch: () => Promise.reject(),
    },
    detections: new Map(),
    requestedChanges: [],
    resolvedChanges,
    repair,
    options: {},
  };
}

async function withRepository(
  action: (root: URL) => Promise<void>,
): Promise<void> {
  const path = await Deno.makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-deno-server-",
  });
  try {
    await action(new URL(`file://${path}/`));
  } finally {
    await Deno.remove(path, { recursive: true });
  }
}
