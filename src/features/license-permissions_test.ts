import { deepStrictEqual as assertEquals, ok as assert } from "node:assert";
import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import * as fs from "node:fs/promises";
import { makeTempDirectory } from "../runtime/temp.ts";
import type { OperationContext } from "../api/repository-context.ts";
import { applyLocalChangePlan } from "../operations/local-change-plan.ts";
import { buildReadmeText } from "../readme/build-readme.ts";
import { LocalFileReader } from "../repository/local-file-reader.ts";
import { LocalGitReader } from "../repository/local-git-reader.ts";
import { createLicenseMitFeature } from "./license-mit-feature.ts";
import { readmeBuildFeature } from "./readme-build-feature.ts";
import { denoTaskDefinitions, readmeTaskDefinition } from "./deno-tasks.ts";

test("license and generated README accept access-equivalent modes and preserve them during edits", async () => {
  const directory = await makeTempDirectory({
    dir: "/tmp/opencode",
    prefix: "license-permissions-",
  });
  const root = new URL(`file://${directory}/`);
  const feature = createLicenseMitFeature(() =>
    Promise.resolve("Copyright <year> <copyright holders>\nterms\n")
  );
  const files = new LocalFileReader(root);
  const context: OperationContext = {
    repositoryRoot: root,
    files,
    git: new LocalGitReader(root),
    requestedChanges: [],
    resolvedChanges: [],
    detections: new Map(),
    options: {},
    repair: { kind: "all-drifted" },
  };
  try {
    await fs.mkdir(new URL("readme/", root));
    await fs.writeFile(
      new URL("deno.json", root),
      JSON.stringify({
        name: "example",
        tasks: {
          ...denoTaskDefinitions([], true),
          readme: readmeTaskDefinition,
        },
      }),
    );
    const source = "# Example\n\n## License\n\n[MIT](../LICENSE)\n";
    await fs.writeFile(new URL("readme/README.md", root), source);
    await fs.writeFile(
      new URL("README.md", root),
      await buildReadmeText(root, source),
    );
    await fs.writeFile(
      new URL("LICENSE", root),
      "Copyright 2026 Ada\nterms\n",
    );
    await fs.chmod(new URL("LICENSE", root), 0o660);
    for (
      const [sourceMode, rootMode] of [[0o600, 0o400], [0o640, 0o440], [
        0o664,
        0o444,
      ], [0o666, 0o464]]
    ) {
      await fs.chmod(new URL("readme/README.md", root), sourceMode);
      await fs.chmod(new URL("README.md", root), rootMode);
      assertEquals((await feature.detect(context)).state, "enabled");
      assertEquals((await feature.checkEnable(context)).result, "no-op");
      assertEquals((await readmeBuildFeature.detect(context)).state, "enabled");
      assertEquals(
        (await readmeBuildFeature.checkEnable(context)).result,
        "no-op",
      );
      assertEquals(await files.mode("readme/README.md"), sourceMode);
      assertEquals(await files.mode("README.md"), rootMode);
    }
    await fs.chmod(new URL("readme/README.md", root), 0o440);
    assertEquals((await feature.detect(context)).state, "enabled");
    assertEquals((await feature.checkEnable(context)).result, "no-op");
    assertEquals((await readmeBuildFeature.detect(context)).state, "drifted");
    assertEquals(await files.mode("LICENSE"), 0o660);
    assertEquals(await files.mode("README.md"), 0o464);
    await fs.chmod(new URL("README.md", root), 0o664);
    await fs.writeFile(new URL("README.md", root), "# Custom output\n");
    assertEquals((await feature.detect(context)).state, "enabled");
    assertEquals((await feature.checkEnable(context)).result, "no-op");
    await fs.chmod(new URL("README.md", root), 0o464);
    // Removal must use the observed 0464 mode in its stale-state guard.
    const remove = await feature.checkDisable(context);
    assert(remove.result === "allowed");
    await applyLocalChangePlan(
      root,
      await feature.planDisable(context, remove),
    );
    assertEquals((await feature.detect(context)).state, "disabled");
    assertEquals(await files.mode("README.md"), 0o464);
    assertEquals(await files.mode("readme/README.md"), 0o440);
  } finally {
    await fs.rm(root, { recursive: true });
  }
});
