import process from "node:process";
import { makeTempDir, remove } from "../testing/files-test-fixtures.ts";
import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import { runCommand } from "../runtime/command.ts";
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { CommandFailure } from "./command-failure.ts";
import { setupGithubRepository } from "./github-repository-setup.ts";
import type {
  GithubRepositorySetup,
  GithubRepositoryTarget,
} from "../repository/github-repository-setup.ts";
import { LocalGitReader } from "../repository/local-git-reader.ts";
import { LocalGithubClient } from "../repository/local-github-client.ts";
import { parseFeatures } from "./parse-features.ts";
import { builtInFeatureRegistry as registry } from "../features/built-in-feature-registry.ts";
import { runFeatureOperation } from "./run-features.ts";
import type { GithubWriter } from "../api/repository-context.ts";
import { githubRepoFeature } from "../features/github-features.ts";
import { readGlobalConfig, runConfig } from "./global-config.ts";

class Setup implements GithubRepositorySetup {
  created: GithubRepositoryTarget[] = [];
  calls: string[] = [];
  viewerLogin() {
    this.calls.push("viewer");
    return Promise.resolve("person");
  }
  assertAbsent() {
    this.calls.push("absent");
    return Promise.resolve();
  }
  create(target: GithubRepositoryTarget) {
    this.calls.push("create");
    this.created.push(target);
    return Promise.resolve();
  }
}
const request = {
  changes: [],
  presets: [],
  applyDefaults: false,
  defaults: [],
};
async function fixture(fn: (root: URL) => Promise<void>) {
  const dir = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "github-setup-",
  });
  const identities = {
    GIT_AUTHOR_NAME: "Setup Test",
    GIT_AUTHOR_EMAIL: "test@example.invalid",
    GIT_COMMITTER_NAME: "Setup Test",
    GIT_COMMITTER_EMAIL: "test@example.invalid",
  };
  const previous = new Map(
    Object.keys(identities).map((key) => [key, process.env[key]]),
  );
  for (const [key, value] of Object.entries(identities)) {
    process.env[key] = value;
  }
  try {
    await fn(new URL(`file://${dir}/`));
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await remove(dir, { recursive: true });
  }
}

test("GitHub creation displays resolved plan before mutations and verifies origin", async () => {
  await fixture(async (root) => {
    const setup = new Setup();
    const events: string[] = [];
    const result = await setupGithubRepository(
      root,
      {
        confirmation: true,
        githubName: "project",
        defaultGithubVisibility: "private",
      },
      request,
      setup,
      () => {
        throw new Error("must not prompt");
      },
      (plan) => {
        assertEquals(setup.created.length, 0);
        events.push(plan);
      },
    );
    assertEquals(setup.created, [{
      owner: "person",
      name: "project",
      visibility: "private",
    }]);
    assertStringIncludes(
      events[0],
      "Owner: person\nName: project\nVisibility: private",
    );
    assertStringIncludes(
      events[0],
      "Remote: add origin https://github.com/person/project.git",
    );
    assertStringIncludes(result, "Created and linked");
    const history = await runCommand("git", {
      cwd: root,
      args: ["log", "--format=%s"],
      stdout: "piped",
    });
    assertEquals(
      new TextDecoder().decode(history.stdout).trim(),
      "chore: init repo",
    );
    const configured = await runCommand("git", {
      cwd: root,
      args: ["config", "--local", "--get", "remote.origin.url"],
      stdout: "piped",
    });
    assertEquals(
      new TextDecoder().decode(configured.stdout).trim(),
      "https://github.com/person/project.git",
    );
  });
});

test("GitHub visibility flags override defaults and presets", async () => {
  for (
    const [flags, expected] of [
      [["--github-repo", "--github-public"], "public"],
      [["--github", "--github-public", "--github-private"], "private"],
      [["--github"], "private"],
      [["--github-repo", "--no-github-private"], "public"],
    ] as const
  ) {
    await fixture(async (root) => {
      const args = parseFeatures(
        ["repo", "features", ...flags, "--yes"],
        registry,
        { "github-visibility": "private" },
      );
      if (args.kind === "interactive") throw new Error("unexpected");
      const setup = new Setup();
      await setupGithubRepository(
        root,
        args,
        args.request,
        setup,
        () => null,
        () => {},
      );
      assertEquals(setup.created[0].visibility, expected);
    });
  }
});

test("unresolved automated visibility has no writes and --yes never guesses", async () => {
  await fixture(async (root) => {
    const setup = new Setup();
    await assertRejects(
      () =>
        setupGithubRepository(
          root,
          { confirmation: true },
          request,
          setup,
          () => {
            throw new Error("must not prompt");
          },
          () => {},
        ),
      Error,
      "visibility is unresolved",
    );
    assertEquals(setup.calls, []);
    assertEquals(await new LocalGitReader(root).isRepository(), false);
  });
});

test("interactive visibility is shown but creation still needs confirmation", async () => {
  await fixture(async (root) => {
    const setup = new Setup();
    await assertRejects(
      () =>
        setupGithubRepository(
          root,
          { confirmation: false },
          request,
          setup,
          () => "public",
          () => {},
        ),
      Error,
      "Visibility: public",
    );
    assertEquals(setup.created, []);
    assertEquals(await new LocalGitReader(root).isRepository(), false);
    await assertRejects(
      () =>
        setupGithubRepository(
          root,
          { confirmation: false },
          request,
          setup,
          () => null,
          () => {},
        ),
      Error,
      "visibility is unresolved",
    );
  });
});

test("existing remotes survive inaccessible GitHub detection", async () => {
  await fixture(async (root) => {
    await runCommand("git", {
      cwd: root,
      args: ["init"],
      stdout: "piped",
      stderr: "piped",
    });
    await runCommand("git", {
      cwd: root,
      args: [
        "remote",
        "add",
        "upstream",
        "https://example.invalid/existing.git",
      ],
    });
    const setup = new Setup();
    await assertRejects(
      () =>
        setupGithubRepository(
          root,
          { confirmation: true, defaultGithubVisibility: "public" },
          request,
          setup,
          () => null,
          () => {},
        ),
      Error,
      "will not replace",
    );
    assertEquals(setup.calls, []);
    assertEquals(await new LocalGitReader(root).remotes(), [{
      name: "upstream",
      url: "https://example.invalid/existing.git",
    }]);
  });
});

test("creation failure is explicit and never initializes or retries", async () => {
  await fixture(async (root) => {
    const setup = new Setup();
    let calls = 0;
    setup.create = () => {
      calls++;
      return Promise.reject(new Error("API rejected"));
    };
    await assertRejects(
      () =>
        setupGithubRepository(
          root,
          { confirmation: true, defaultGithubVisibility: "private" },
          request,
          setup,
          () => null,
          () => {},
        ),
      Error,
      "failed or is unconfirmed",
    );
    assertEquals(calls, 1);
    assertEquals(await new LocalGitReader(root).isRepository(), false);
  });
});

test("creation followed by a remote race preserves new remote and reports recovery", async () => {
  await fixture(async (root) => {
    const setup = new Setup();
    setup.create = async () => {
      await runCommand("git", {
        cwd: root,
        args: ["init"],
        stdout: "piped",
        stderr: "piped",
      });
      await runCommand("git", {
        cwd: root,
        args: ["remote", "add", "origin", "https://example.invalid/race.git"],
      });
    };
    await assertRejects(
      () =>
        setupGithubRepository(
          root,
          { confirmation: true, defaultGithubVisibility: "public" },
          request,
          setup,
          () => null,
          () => {},
        ),
      Error,
      "but linking failed",
    );
    assertEquals(
      (await new LocalGitReader(root).remotes())[0].url,
      "https://example.invalid/race.git",
    );
  });
});

test("repository options validate input and configuration persists visibility", async () => {
  assertThrows(
    () =>
      parseFeatures(["repo", "features", "--github-owner=../bad"], registry),
    Error,
    "valid",
  );
  assertThrows(
    () => parseFeatures(["repo", "features", "--github-name=repo"], registry),
    Error,
    "require",
  );
  assertThrows(
    () =>
      parseFeatures([
        "repo",
        "features",
        "--github-owner=person",
        "--github-owner=again",
      ], registry),
    Error,
    "duplicate",
  );
  const parsed = parseFeatures([
    "repo",
    "features",
    "--github-repo",
    "--github-owner=team",
    "--github-name=repo",
  ], registry);
  assertEquals(parsed.githubOwner, "team");
  assertEquals(parsed.githubName, "repo");
  await fixture(async (root) => {
    const file = new URL("config.json", root);
    await runConfig(["set", "github-visibility", "public"], file, registry);
    assertEquals(await readGlobalConfig(file, registry), {
      "github-visibility": "public",
    });
    await assertRejects(
      () => runConfig(["set", "github-visibility", "internal"], file, registry),
      Error,
      "public or private",
    );
    assertEquals(await readGlobalConfig(file, registry), {
      "github-visibility": "public",
    });
  });
});

function github(setup: Setup, initiallyLinked = false): GithubWriter {
  return {
    repository: () =>
      Promise.resolve(
        initiallyLinked || setup.created.length
          ? { owner: "person", name: "project" }
          : undefined,
      ),
    rulesets: () => Promise.resolve([]),
    environments: () => Promise.resolve([]),
    variables: () => Promise.resolve([]),
    secretExists: () => Promise.resolve(false),
    resource: () => Promise.resolve(undefined),
    upsertResources: () => Promise.resolve(),
    deleteResources: () => Promise.resolve(),
  };
}

test("feature setup creates once, refreshes detection, and preserves existing links", async () => {
  await fixture(async (root) => {
    const setup = new Setup();
    const features = { features: [githubRepoFeature], capabilities: [] };
    const args = parseFeatures(
      ["repo", "features", "--github-repo", "--yes"],
      features,
      { "github-visibility": "private" },
    );
    const services = {
      github: github(setup),
      githubRepositorySetup: setup,
      reportGithubPlan: () => {},
    };
    const result = await runFeatureOperation(
      root,
      args,
      features,
      () => [],
      services,
    );
    assertStringIncludes(result, "Created and linked");
    assertEquals(setup.created.length, 1);
    const remotes = await new LocalGitReader(root).remotes();
    await runFeatureOperation(root, args, features, () => [], services);
    assertEquals(setup.created.length, 1);
    assertEquals(await new LocalGitReader(root).remotes(), remotes);
  });
});

test("status never invokes repository creation or visibility prompts", async () => {
  await fixture(async (root) => {
    const setup = new Setup();
    const features = { features: [githubRepoFeature], capabilities: [] };
    await runFeatureOperation(
      root,
      parseFeatures(["repo", "features"], features),
      features,
      () => [],
      {
        github: github(setup),
        githubRepositorySetup: setup,
        ensureGithubAuthentication: () => {
          throw new Error("status must not authenticate");
        },
        promptGithubVisibility: () => {
          throw new Error("must not prompt");
        },
      },
    );
    assertEquals(setup.calls, []);
    assertEquals(await new LocalGitReader(root).isRepository(), false);
  });
});

Deno.test("a GitHub preset signs in before resolving an unreadable existing remote and refreshes failed reads", async () => {
  await fixture(async (root) => {
    for (
      const args of [["init"], [
        "remote",
        "add",
        "origin",
        "https://github.com/person/project.git",
      ]]
    ) {
      assertEquals(
        (await new Deno.Command("git", { args, cwd: root }).output()).success,
        true,
      );
    }
    const beforeRemotes = await new LocalGitReader(root).remotes();
    let signedIn = false;
    let authentications = 0;
    const client = new LocalGithubClient(root, {
      run: () =>
        Promise.resolve({
          success: signedIn,
          code: signedIn ? 0 : 1,
          stdout: new TextEncoder().encode(
            signedIn
              ? JSON.stringify({
                nameWithOwner: "person/project",
                defaultBranchRef: { name: "main" },
              })
              : "{}",
          ),
        }),
    });
    const features = {
      features: [githubRepoFeature],
      capabilities: [],
      presets: [{
        id: "github",
        name: "GitHub",
        summary: "GitHub",
        changes: [{ featureId: "github-repo", enabled: true }],
      }],
    };
    const output = await runFeatureOperation(
      root,
      parseFeatures(["repo", "features", "--github", "--yes"], features),
      features,
      () => [],
      {
        github: client,
        ensureGithubAuthentication: () => {
          authentications++;
          signedIn = true;
          return Promise.resolve();
        },
        githubRepositorySetup: {
          ...new Setup(),
          viewerLogin: () => {
            throw new Error("existing remote must remain linked");
          },
          assertAbsent: () => {
            throw new Error("unexpected creation");
          },
          create: () => {
            throw new Error("unexpected creation");
          },
        },
      },
    );
    assertEquals(authentications, 1);
    assertStringIncludes(output, "No changes.");
    assertEquals(client.diagnostics, []);
    assertEquals(await new LocalGitReader(root).remotes(), beforeRemotes);
  });
});

test("later feature failures retain the created repository and report retry instructions", async () => {
  await fixture(async (root) => {
    const setup = new Setup();
    const features = {
      capabilities: [],
      features: [githubRepoFeature, {
        ...githubRepoFeature,
        metadata: {
          id: "github-example",
          name: "Example",
          summary: "Test dependency planning after creation.",
        },
        dependencies: {
          requires: [{
            featureId: "github-repo",
            reason: "Needs repository settings.",
          }],
        },
        detect: () =>
          Promise.resolve({ state: "disabled" as const, evidence: [] }),
        checkEnable: () =>
          Promise.resolve({
            result: "blocked" as const,
            warnings: [],
            blockers: [{
              code: "unavailable",
              message: "Example setup is unavailable.",
              subjects: [],
              resolution: "Resolve the example.",
            }],
          }),
      }],
    };
    const args = parseFeatures(
      ["repo", "features", "--github-example", "--yes"],
      features,
      { "github-visibility": "private" },
    );
    const error = await assertRejects(
      () =>
        runFeatureOperation(root, args, features, () => [], {
          github: github(setup),
          githubRepositorySetup: setup,
          reportGithubPlan: () => {},
        }),
      Error,
      "Remaining setup failed",
    );
    assertStringIncludes(error.message, "Keep the linked repository");
    assertEquals(setup.created.length, 1);
    assertEquals((await new LocalGitReader(root).remotes()).length, 1);
  });
});

test("repository setup respects an explicit request to disable Git", async () => {
  await fixture(async (root) => {
    const setup = new Setup();
    await assertRejects(
      () =>
        setupGithubRepository(
          root,
          { confirmation: true, defaultGithubVisibility: "private" },
          { ...request, changes: [{ featureId: "git", enabled: false }] },
          setup,
          () => null,
          () => {},
        ),
      Error,
      "Remove --no-git",
    );
    assertEquals(setup.calls, []);
    assertEquals(await new LocalGitReader(root).isRepository(), false);
  });
});

test("setup retains the child command exit code after repository creation", async () => {
  await fixture(async (root) => {
    const setup = new Setup();
    const features = {
      capabilities: [],
      features: [githubRepoFeature, {
        ...githubRepoFeature,
        metadata: {
          id: "github-command",
          name: "Command",
          summary: "A failing project command.",
        },
        dependencies: {
          requires: [{
            featureId: "github-repo",
            reason: "Needs the repository.",
          }],
        },
        detect: () =>
          Promise.resolve({ state: "disabled" as const, evidence: [] }),
        checkEnable: () =>
          Promise.reject(new CommandFailure("Project command failed.", 23)),
      }],
    };
    const error = await assertRejects(
      () =>
        runFeatureOperation(
          root,
          parseFeatures(
            ["repo", "features", "--github-command", "--yes"],
            features,
            { "github-visibility": "private" },
          ),
          features,
          () => [],
          {
            github: github(setup),
            githubRepositorySetup: setup,
            reportGithubPlan: () => {},
          },
        ),
      CommandFailure,
      "Created and linked",
    );
    assertEquals(error.exitCode, 23);
    assertEquals(setup.created.length, 1);
  });
});
