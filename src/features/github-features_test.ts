import { assertEquals, assertRejects } from "@std/assert";
import type {
  GithubResource,
  GithubResourceUpsert,
  GithubWriter,
} from "../api/repository-context.ts";
import { digestBytes } from "../repository/digest-bytes.ts";
import { builtInFeatureRegistry } from "./built-in-feature-registry.ts";
import { githubSettings } from "./github-features.ts";
import { parseFeatures } from "../cli/parse-features.ts";
import { runFeatureOperation } from "../cli/run-features.ts";

Deno.test("Github settings require confirmation and only patch their requested field", async () => {
  await withRoot(async (root) => {
    const github = new FakeGithub({ has_issues: false, has_wiki: true });
    const args = parseFeatures(
      ["repo", "features", "--github-issues"],
      builtInFeatureRegistry,
    );
    await assertRejects(() =>
      runFeatureOperation(root, args, builtInFeatureRegistry, () => [], {
        github,
      })
    );
    assertEquals(github.patches, []);
    const result = await runFeatureOperation(
      root,
      parseFeatures(
        ["repo", "features", "--github-issues", "--yes"],
        builtInFeatureRegistry,
      ),
      builtInFeatureRegistry,
      () => [],
      { github },
    );
    assertEquals(github.patches, [{ has_issues: true }]);
    assertEquals(github.values, { has_issues: true, has_wiki: true });
    assertEquals(result.endsWith("Applied GitHub changes."), true);
  });
});

Deno.test("GitHub private visibility can be explicitly disabled", async () => {
  await withRoot(async (root) => {
    const github = new FakeGithub({ private: true });
    await runFeatureOperation(
      root,
      parseFeatures(
        ["repo", "features", "--no-github-private", "--yes"],
        builtInFeatureRegistry,
      ),
      builtInFeatureRegistry,
      () => [],
      { github },
    );
    assertEquals(github.patches, [{ private: false }]);
  });
});

Deno.test("Github preset values are independently overridable", async () => {
  await withRoot(async (root) => {
    const github = new FakeGithub({
      allow_auto_merge: false,
      allow_merge_commit: true,
      has_issues: true,
    });
    await runFeatureOperation(
      root,
      parseFeatures([
        "repo",
        "features",
        "--github",
        "--no-github-issues",
        "--yes",
      ], builtInFeatureRegistry),
      builtInFeatureRegistry,
      () => [],
      { github },
    );
    assertEquals(github.values.allow_auto_merge, true);
    assertEquals(github.values.allow_merge_commit, false);
    assertEquals(github.values.has_issues, false);
  });
});

Deno.test("GitHub public preset overlays GitHub but yields to private flag", async () => {
  await withRoot(async (root) => {
    const github = new FakeGithub(Object.fromEntries(
      githubSettings.map(({ field, enabled }) => [field, enabled]),
    ));
    await runFeatureOperation(
      root,
      parseFeatures(
        ["repo", "features", "--github", "--github-public", "--yes"],
        builtInFeatureRegistry,
      ),
      builtInFeatureRegistry,
      () => [],
      { github },
    );
    assertEquals(github.patches, [{ private: false }]);
    await runFeatureOperation(
      root,
      parseFeatures([
        "repo",
        "features",
        "--github-public",
        "--github",
        "--github-private",
        "--yes",
      ], builtInFeatureRegistry),
      builtInFeatureRegistry,
      () => [],
      { github },
    );
    assertEquals(github.patches, [{ private: false }, { private: true }]);
  });
});

Deno.test("pure GitHub preset blocks inaccessible repositories before mutation", async () => {
  await withRoot(async (root) => {
    const github = new FakeGithub({}, false);
    await assertRejects(
      () =>
        runFeatureOperation(
          root,
          parseFeatures(
            ["repo", "features", "--github", "--yes"],
            builtInFeatureRegistry,
          ),
          builtInFeatureRegistry,
          () => [],
          { github },
        ),
      Error,
      "GitHub repository access is required",
    );
    assertEquals(github.patches, []);
  });
});

Deno.test("pure GitHub preset confirms before one atomic patch", async () => {
  await withRoot(async (root) => {
    const values = Object.fromEntries(
      githubSettings.map(({ field, enabled }) => [field, !enabled]),
    );
    const github = new FakeGithub(values);
    const args = parseFeatures(
      ["repo", "features", "--github"],
      builtInFeatureRegistry,
    );
    await assertRejects(() =>
      runFeatureOperation(root, args, builtInFeatureRegistry, () => [], {
        github,
      })
    );
    assertEquals(github.patches, []);
    await runFeatureOperation(
      root,
      parseFeatures(
        ["repo", "features", "--github", "--yes"],
        builtInFeatureRegistry,
      ),
      builtInFeatureRegistry,
      () => [],
      { github },
    );
    assertEquals(github.patches, [Object.fromEntries(
      githubSettings.map(({ field, enabled }) => [field, enabled]),
    )]);
  });
});

Deno.test("unavailable GitHub setting fields fail closed", async () => {
  await withRoot(async (root) => {
    const github = new FakeGithub({}, true, new Set(["has_issues"]));
    await assertRejects(
      () =>
        runFeatureOperation(
          root,
          parseFeatures(
            ["repo", "features", "--github-issues", "--yes"],
            builtInFeatureRegistry,
          ),
          builtInFeatureRegistry,
          () => [],
          { github },
        ),
      Error,
      "ambiguous-feature",
    );
    assertEquals(github.patches, []);
  });
});

Deno.test("mixed operations apply GitHub before local changes", async () => {
  await withRoot(async (root) => {
    const github = new FakeGithub({ has_issues: false });
    await runFeatureOperation(
      root,
      parseFeatures(
        ["repo", "features", "--github-issues", "--readme", "--yes"],
        builtInFeatureRegistry,
      ),
      builtInFeatureRegistry,
      () => [],
      { github },
    );
    assertEquals(github.patches, [{ has_issues: true }]);
    assertEquals(
      (await Deno.readTextFile(new URL("README.md", root))).startsWith(
        "# hj-github-",
      ),
      true,
    );
  });
});

class FakeGithub implements GithubWriter {
  readonly patches: Record<string, boolean>[] = [];
  readonly values: Record<string, boolean>;
  constructor(
    values: Record<string, boolean> = {},
    readonly accessible = true,
    readonly missing = new Set<string>(),
  ) {
    this.values = values;
  }
  repository() {
    return Promise.resolve(
      this.accessible
        ? {
          owner: "owner",
          name: "repo",
          defaultBranch: "main",
        }
        : undefined,
    );
  }
  rulesets() {
    return Promise.resolve([]);
  }
  environments() {
    return Promise.resolve([]);
  }
  variables() {
    return Promise.resolve([]);
  }
  secretExists() {
    return Promise.resolve(undefined);
  }
  async resource(
    kind: string,
    name: string,
  ): Promise<GithubResource | undefined> {
    if (kind !== "repository-setting" || this.missing.has(name)) {
      return undefined;
    }
    const value = this.values[name] ?? false;
    return {
      kind,
      name,
      definition: { value },
      stateDigest: await digest(name, value),
    };
  }
  async upsertResources(
    resources: readonly GithubResourceUpsert[],
  ): Promise<void> {
    const patch: Record<string, boolean> = {};
    for (const resource of resources) {
      if (
        (await this.resource(resource.resource, resource.name))?.stateDigest !==
          resource.expectedStateDigest
      ) throw new Error("stale");
      if (typeof resource.definition.value !== "boolean") {
        throw new Error("bad");
      }
      const previous = patch[resource.name];
      if (previous !== undefined && previous !== resource.definition.value) {
        throw new Error("contradictory");
      }
      patch[resource.name] = resource.definition.value;
    }
    Object.assign(this.values, patch);
    this.patches.push(patch);
  }
  deleteResources() {
    return Promise.resolve();
  }
}

async function digest(name: string, value: boolean): Promise<string> {
  return await digestBytes(
    new TextEncoder().encode(JSON.stringify({ [name]: value })),
  );
}
async function withRoot(action: (root: URL) => Promise<void>): Promise<void> {
  const path = await Deno.makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-github-",
  });
  try {
    await action(new URL(`file://${path}/`));
  } finally {
    await Deno.remove(path, { recursive: true });
  }
}
