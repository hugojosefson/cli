import { parse } from "jsonc-parser";
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { builtInFeatureRegistry as registry } from "../features/built-in-feature-registry.ts";
import { resolveFeatureChanges } from "../features/resolve-feature-changes.ts";
import {
  globalConfigFile,
  readGlobalConfig,
  runConfig,
} from "./global-config.ts";
import { parseFeatures } from "./parse-features.ts";
import { runCli } from "./run-cli.ts";

Deno.test("global configuration resolves XDG or HOME without depending on the repository", () => {
  const path = (values: Record<string, string>) =>
    globalConfigFile({ get: (name) => values[name] }).pathname;
  assertEquals(
    path({ XDG_CONFIG_HOME: "/tmp/settings", HOME: "/home/person" }),
    "/tmp/settings/hj/config.json",
  );
  assertEquals(
    path({ XDG_CONFIG_HOME: "relative", HOME: "/home/person" }),
    "/home/person/.config/hj/config.json",
  );
  assertEquals(
    path({ HOME: "/home/person" }),
    "/home/person/.config/hj/config.json",
  );
  assertThrows(() => path({ HOME: "relative" }), Error, "absolute");
  assertThrows(() => path({}), Error, "absolute");
});

Deno.test("configuration commands persist non-secret defaults and read without creating files", async () => {
  const dir = await Deno.makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-global-",
  });
  const root = new URL(`file://${dir}/`);
  const file = new URL("settings/hj/config.json", root);
  const call = (args: string[]) =>
    runCli(root, ["config", ...args], { globalConfigFile: file });
  try {
    assertEquals((await call(["list"])).output, "{}");
    await assertRejects(
      () => Deno.stat(new URL("settings", root)),
      Deno.errors.NotFound,
    );
    await assertRejects(() => call(["get", "features"]), Error, "not set");
    assertEquals(
      (await call(["unset", "features"])).output,
      "Configuration unchanged.",
    );
    await assertRejects(
      () => Deno.stat(new URL("settings", root)),
      Deno.errors.NotFound,
    );
    assertEquals(
      (await call(["set", "features", '["deno-lib","readme"]'])).output,
      "Set features.",
    );
    assertEquals(
      (await call(["get", "features"])).output,
      '["deno-lib","readme"]',
    );
    await call(["set", "deno-version", "2.8.1"]);
    assertEquals((await call(["get", "deno-version"])).output, "2.8.1");
    assertEquals(await readGlobalConfig(file, registry), {
      features: ["deno-lib", "readme"],
      "deno-version": "2.8.1",
    });
    assertEquals(
      (await call(["set", "deno-version", "2.8.1"])).output,
      "Configuration unchanged.",
    );
    assertEquals((await call(["unset", "features"])).output, "Unset features.");
    assertEquals(JSON.parse((await call(["list"])).output), {
      "deno-version": "2.8.1",
    });
    await call(["unset", "deno-version"]);
    assertEquals(await Deno.readTextFile(file), "{}\n");
    assertEquals(
      [...Deno.readDirSync(new URL(".", file))].map((entry) => entry.name),
      ["config.json"],
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("configuration rejects invalid values and keeps previous bytes", async () => {
  const dir = await Deno.makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-global-invalid-",
  });
  const file = new URL(`file://${dir}/config.json`);
  try {
    await Deno.writeTextFile(file, '{"features":[]}\n');
    for (
      const args of [
        ["set", "token", "secret"],
        ["get", "password"],
        ["unset", "token"],
        ["set", "features", "git"],
        ["set", "features", '"git"'],
        ["set", "features", '["unknown"]'],
        ["set", "features", '["git","git"]'],
        ["set", "features", "[2]"],
        ["set", "deno-version", "latest"],
        ["set", "deno-version", "2.9.6\nrun: malicious"],
        ["set", "deno-version", "02.9.6"],
        ["set", "deno-version"],
        ["list", "extra"],
        ["unknown"],
      ]
    ) {
      await assertRejects(() => runConfig(args, file, registry));
      assertEquals(await Deno.readTextFile(file), '{"features":[]}\n');
    }
    for (
      const text of [
        "{broken",
        "null",
        "[]",
        "1",
        '{"secret":"redacted"}',
        '{"features":false}',
        '{"deno-version":true}',
      ]
    ) {
      await Deno.writeTextFile(file, text);
      const error = await assertRejects(
        () => readGlobalConfig(file, registry),
        Error,
      );
      assertEquals(error.message.includes("redacted"), false);
      await assertRejects(() =>
        runConfig(["set", "features", "[]"], file, registry)
      );
      assertEquals(await Deno.readTextFile(file), text);
    }
    await assertRejects(() =>
      readGlobalConfig(new URL(`file://${dir}/`), registry)
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("flags override configured feature and Deno defaults; status stays read-only", async () => {
  const defaults = {
    features: ["deno-lib", "readme"],
    "deno-version": "2.8.1",
  };
  const args = parseFeatures(
    ["repo", "features", "--defaults", "--no-deno-lib", "--deno-cli"],
    registry,
    defaults,
  );
  if (args.kind !== "change") throw new Error("Expected changes");
  const detections = Object.fromEntries(
    registry.features.map((
      feature,
    ) => [feature.metadata.id, { state: "disabled" as const, evidence: [] }]),
  );
  const result = resolveFeatureChanges(registry, detections, args.request);
  assertEquals(result.issues, []);
  assertEquals(
    result.changes.some((change) =>
      change.featureId === "deno-lib" && change.enabled
    ),
    false,
  );
  assertEquals(
    result.changes.some((change) =>
      change.featureId === "deno-cli" && change.enabled
    ),
    true,
  );
  assertEquals(args.defaultDenoVersion, "2.8.1");
  const workflow = parseFeatures(
    ["repo", "features", "--github-ci", "--deno-version=2.9.0"],
    registry,
    defaults,
  );
  if (workflow.kind !== "change") throw new Error("Expected changes");
  assertEquals(workflow.denoVersion, "2.9.0");
  assertEquals(workflow.defaultDenoVersion, "2.8.1");
  assertEquals(
    parseFeatures(["repo", "features"], registry, defaults).kind,
    "status",
  );
  assertEquals(
    parseFeatures(["repo", "features", "--interactive"], registry, defaults),
    {
      kind: "interactive",
      confirmation: false,
      defaultDenoVersion: "2.8.1",
      configuredDefaults: [{ kind: "feature", featureId: "deno-lib" }, {
        kind: "capability",
        capabilityId: "readme",
      }],
    },
  );
  for (
    const flags of [["--deno-version=latest"], ["--deno-version=2.9.0"], [
      "--github-ci",
      "--deno-version=2.9.0",
      "--deno-version=2.9.0",
    ], ["-i", "--deno-version=2.9.0"]]
  ) {
    assertThrows(() => parseFeatures(["repo", "features", ...flags], registry));
  }
  const dir = await Deno.makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-global-status-",
  });
  const root = new URL(`file://${dir}/`);
  const file = new URL("invalid.json", root);
  try {
    await Deno.writeTextFile(file, "invalid");
    assertStringIncludes(
      (await runCli(root, ["repo", "features"], { globalConfigFile: file }))
        .output,
      "disabled",
    );
    assertStringIncludes(
      (await runCli(root, ["config", "set", "--help"], {
        globalConfigFile: file,
      })).output,
      "Save a non-secret default",
    );
    await assertRejects(
      () =>
        runCli(root, ["repo", "features", "--defaults"], {
          globalConfigFile: file,
        }),
      Error,
      "invalid JSON",
    );
    assertEquals([...Deno.readDirSync(root)].map((entry) => entry.name), [
      "invalid.json",
    ]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("configured interactive selections take priority over remaining prompt choices", async () => {
  const { interactiveFeatureRequest } = await import(
    "./interactive-feature-defaults.ts"
  );
  const detections = new Map(
    registry.features.map((
      feature,
    ) => [feature.metadata.id, { state: "disabled" as const, evidence: [] }]),
  );
  const defaults = [{ kind: "feature" as const, featureId: "license-mit" }, {
    kind: "capability" as const,
    capabilityId: "readme",
  }];
  const request = interactiveFeatureRequest(
    registry,
    detections,
    defaults,
    (actions) => {
      assertEquals(
        actions.some((action) => action.value.includes("license-")),
        false,
      );
      assertEquals(
        actions.some((action) => action.value.includes("readme-")),
        false,
      );
      return ["enable:git"];
    },
  );
  assertEquals(request.defaults, defaults);
  assertEquals(request.applyDefaults, true);
  assertEquals(request.changes, [{ featureId: "git", enabled: true }]);
  assertThrows(
    () =>
      interactiveFeatureRequest(
        registry,
        detections,
        defaults,
        () => ["disable:license-mit"],
      ),
    Error,
    "conflicts",
  );
  assertEquals(
    interactiveFeatureRequest(registry, detections, undefined, () => [])
      .applyDefaults,
    false,
  );
  assertEquals(
    interactiveFeatureRequest(
      { features: [], capabilities: [] },
      new Map(),
      [],
      () => {
        throw new Error("unexpected prompt");
      },
    ).changes,
    [],
  );
});

Deno.test("repository feature dispatch applies configured defaults and honors explicit opt-outs", async () => {
  const dir = await Deno.makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-global-apply-",
  });
  const base = new URL(`file://${dir}/`);
  const root = new URL("project/", base);
  const file = new URL("config.json", base);
  try {
    await Deno.mkdir(root);
    await runConfig(["set", "features", '["deno-fmt"]'], file, registry);
    await runCli(root, ["repo", "features", "--defaults", "--no-deno-fmt"], {
      globalConfigFile: file,
    });
    assertEquals([...Deno.readDirSync(root)], []);
    const result = await runCli(root, ["repo", "features", "--defaults"], {
      globalConfigFile: file,
    });
    assertStringIncludes(result.output, "deno-fmt");
    const config = parse(
      await Deno.readTextFile(new URL("deno.jsonc", root)),
    );
    assertStringIncludes(JSON.stringify(config.tasks), "deno fmt");
    await assertRejects(
      () => Deno.stat(new URL(".git", root)),
      Deno.errors.NotFound,
    );
    await assertRejects(
      () => Deno.stat(new URL("README.md", root)),
      Deno.errors.NotFound,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
