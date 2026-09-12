import { assert, assertEquals, assertRejects } from "@std/assert";
import type { ChangePlan } from "../api/change-plan.ts";
import type { OperationContext } from "../api/repository-context.ts";
import { prepareDenoLock, refreshDenoLock } from "../cli/deno-lock.ts";
import { applyLocalChangePlan } from "../operations/local-change-plan.ts";
import { LocalFileReader } from "../repository/local-file-reader.ts";
import { LocalGitReader } from "../repository/local-git-reader.ts";
import { denoFmtFeature } from "./deno-fmt-feature.ts";
import {
  denoLockOwnershipPath,
  readDenoLockOwnership,
  reconcileDenoLockPlans,
} from "./deno-lock-policy.ts";

Deno.test("shared lock policy follows library, CLI, server and last application removal", async () => {
  await repository(async (root) => {
    const ctx = context(root, { "deno-fmt": true });
    const allowed = await denoFmtFeature.checkEnable(ctx);
    assertEquals(allowed.result, "allowed");
    if (allowed.result !== "allowed") return;
    for (
      const plan of await reconcileDenoLockPlans(ctx, [
        await denoFmtFeature.planEnable(ctx, allowed),
      ])
    ) await applyLocalChangePlan(root, plan);
    assertEquals(await lockValue(root), false);
    await transition(root, { "deno-cli": true });
    assertEquals(await lockValue(root), true);
    assertEquals(await prepareDenoLock(root), [
      "deno.lock",
      denoLockOwnershipPath,
    ]);
    assert((await readDenoLockOwnership(new LocalFileReader(root)))?.digest);
    await transition(root, { "deno-server": true }, ["deno-cli"]);
    await transition(root, { "deno-cli": false }, ["deno-server"]);
    assertEquals(await lockValue(root), true);
    await transition(root, { "deno-server": false });
    assertEquals(await lockValue(root), false);
    assertEquals(await new LocalFileReader(root).exists("deno.lock"), false);
  });
});

Deno.test("formatter removal removes its standalone configuration and ownership record", async () => {
  await repository(async (root) => {
    const enableContext = context(root, { "deno-fmt": true });
    const allowed = await denoFmtFeature.checkEnable(enableContext);
    assert(allowed.result === "allowed");
    for (
      const item of await reconcileDenoLockPlans(enableContext, [
        await denoFmtFeature.planEnable(enableContext, allowed),
      ])
    ) await applyLocalChangePlan(root, item);
    const disableContext = context(root, { "deno-fmt": false });
    const disable = await denoFmtFeature.checkDisable(disableContext);
    assert(disable.result === "allowed");
    for (
      const item of await reconcileDenoLockPlans(disableContext, [
        await denoFmtFeature.planDisable(disableContext, disable),
      ])
    ) await applyLocalChangePlan(root, item);
    assertEquals(await new LocalFileReader(root).exists("deno.jsonc"), false);
    assertEquals(
      await new LocalFileReader(root).exists(denoLockOwnershipPath),
      false,
    );
  });
});

Deno.test("explicit lock requirement survives application removal and generates a missing file", async () => {
  await repository(async (root) => {
    await Deno.writeTextFile(new URL("deno.jsonc", root), '{"lock":true}\n');
    await transition(root, { "deno-cli": true });
    await prepareDenoLock(root);
    await transition(root, { "deno-cli": false });
    assertEquals(await lockValue(root), true);
    assertEquals(await new LocalFileReader(root).exists("deno.lock"), true);
    assertEquals(
      (await readDenoLockOwnership(new LocalFileReader(root)))?.explicit,
      true,
    );
  });
});

Deno.test("custom lock paths and content are preserved without inferred ownership", async () => {
  for (
    const lock of ["custom.lock", { path: "locks/deps.json", frozen: true }]
  ) {
    await repository(async (root) => {
      const content = JSON.stringify({ lock });
      await Deno.writeTextFile(new URL("deno.jsonc", root), content);
      await Deno.writeTextFile(new URL("deno.lock", root), "custom bytes\n");
      await transition(root, { "deno-cli": true });
      assertEquals(
        await Deno.readTextFile(new URL("deno.jsonc", root)),
        content,
      );
      assertEquals(await prepareDenoLock(root), []);
      assertEquals(
        await Deno.readTextFile(new URL("deno.lock", root)),
        "custom bytes\n",
      );
    });
  }
  await repository(async (root) => {
    await Deno.writeTextFile(new URL("deno.jsonc", root), "{}\n");
    await Deno.writeTextFile(new URL("deno.lock", root), "custom bytes\n");
    await transition(root, { "deno-cli": true });
    assertEquals(await prepareDenoLock(root), []);
    await transition(root, { "deno-cli": false });
    assertEquals(await lockValue(root), false);
    assertEquals(
      await Deno.readTextFile(new URL("deno.lock", root)),
      "custom bytes\n",
    );
  });
});

Deno.test("edited formerly owned lock is preserved, while unchanged stale plans fail safely", async () => {
  await repository(async (root) => {
    await Deno.writeTextFile(new URL("deno.jsonc", root), "{}\n");
    await transition(root, { "deno-cli": true });
    await prepareDenoLock(root);
    const ctx = context(root, { "deno-cli": false });
    const plans = await reconcileDenoLockPlans(ctx, [plan("deno-cli", false)]);
    await Deno.writeTextFile(new URL("deno.lock", root), "user changes\n");
    await assertRejects(() => applyLocalChangePlan(root, plans[0]!));
    assertEquals(
      await Deno.readTextFile(new URL("deno.lock", root)),
      "user changes\n",
    );
    await transition(root, { "deno-cli": false });
    assertEquals(
      await Deno.readTextFile(new URL("deno.lock", root)),
      "user changes\n",
    );
  });
});

Deno.test("lock cache populates a local dependency graph before frozen checks", async () => {
  await repository(async (root) => {
    await Deno.writeTextFile(new URL("deno.jsonc", root), "{}\n");
    await Deno.mkdir(new URL("src/", root));
    await Deno.writeTextFile(
      new URL("src/main.ts", root),
      'import { value } from "./value.ts"; export { value };\n',
    );
    await Deno.writeTextFile(
      new URL("src/value.ts", root),
      "export const value = 1;\n",
    );
    await transition(root, { "deno-cli": true });
    await prepareDenoLock(root);
    const checked = await new Deno.Command("deno", {
      args: ["check", "--frozen", "src/main.ts"],
      cwd: root,
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(checked.code, 0, new TextDecoder().decode(checked.stderr));
    await refreshDenoLock(root);
    assertEquals(
      (await readDenoLockOwnership(new LocalFileReader(root)))?.digest,
      await new LocalFileReader(root).digest("deno.lock"),
    );
  });
});

Deno.test("lock generation records dependency integrity before frozen checks and reports failure", async () => {
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen() {} },
    () =>
      new Response("export const value = 42;", {
        headers: { "content-type": "application/typescript" },
      }),
  );
  try {
    await repository(async (root) => {
      const url = `http://127.0.0.1:${server.addr.port}/value.ts`;
      await Deno.writeTextFile(new URL("deno.jsonc", root), "{}\n");
      await Deno.writeTextFile(
        new URL("main.ts", root),
        `export { value } from "${url}";\n`,
      );
      await transition(root, { "deno-cli": true });
      await prepareDenoLock(root);
      const lock = JSON.parse(
        await Deno.readTextFile(new URL("deno.lock", root)),
      );
      assertEquals(typeof lock.remote[url], "string");
      const check = await new Deno.Command("deno", {
        args: ["check", "--allow-import", "--frozen", "main.ts"],
        cwd: root,
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(check.code, 0, new TextDecoder().decode(check.stderr));
      await Deno.writeTextFile(
        new URL("main.ts", root),
        'import "./missing.ts";\n',
      );
      await assertRejects(
        () => prepareDenoLock(root),
        Error,
        "generation failed",
      );
    });
  } finally {
    await server.shutdown();
  }
});

Deno.test("invalid ownership record blocks policy adoption", async () => {
  await repository(async (root) => {
    await Deno.writeTextFile(new URL("deno.jsonc", root), "{}\n");
    await Deno.mkdir(new URL(".hj/", root));
    await Deno.writeTextFile(
      new URL(denoLockOwnershipPath, root),
      '{"custom":true}\n',
    );
    await assertRejects(
      () => transition(root, { "deno-cli": true }),
      Error,
      "unrecognized",
    );
    assertEquals(await Deno.readTextFile(new URL("deno.jsonc", root)), "{}\n");
  });
});

function plan(featureId: string, enabled: boolean): ChangePlan {
  return {
    featureId,
    action: enabled ? "enable" : "disable",
    summary: "test feature change",
    warnings: [],
    preconditions: [],
    changes: [],
    validations: [],
  };
}
function context(
  root: URL,
  changes: Record<string, boolean>,
  active: string[] = [],
): OperationContext {
  return {
    repositoryRoot: root,
    files: new LocalFileReader(root),
    git: new LocalGitReader(root),
    detections: new Map(
      active.map((id) => [id, { state: "enabled", evidence: [] }]),
    ),
    requestedChanges: [],
    resolvedChanges: Object.entries(changes).map(([featureId, enabled]) => ({
      featureId,
      enabled,
      reason: { kind: "explicit-request" },
    })),
    repair: undefined,
    options: {},
  };
}
async function transition(
  root: URL,
  changes: Record<string, boolean>,
  active: string[] = [],
) {
  for (
    const item of await reconcileDenoLockPlans(
      context(root, changes, active),
      Object.entries(changes).map(([id, enabled]) => plan(id, enabled)),
    )
  ) await applyLocalChangePlan(root, item);
}
async function lockValue(root: URL) {
  return (await new LocalFileReader(root).readJson("deno.jsonc"))!.value &&
    JSON.parse(await Deno.readTextFile(new URL("deno.jsonc", root))).lock;
}
async function repository(action: (root: URL) => Promise<void>) {
  const path = await Deno.makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-lock-",
  });
  try {
    await action(new URL(`file://${path}/`));
  } finally {
    await Deno.remove(path, { recursive: true });
  }
}
