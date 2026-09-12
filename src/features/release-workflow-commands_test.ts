import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import {
  chmod,
  makeTempDir,
  remove,
  writeTextFile,
} from "../testing/files-test-fixtures.ts";
import { runCommand } from "../runtime/command.ts";
import { assertEquals, assertStringIncludes } from "@std/assert";
import { parse } from "yaml";
import {
  publishGithubArtifact,
  publishJsrArtifact,
  publishTagArtifact,
} from "./github-release-publish-artifacts.ts";

test("JSR dispatch selects the protected tag without interpreting input as shell code", async () => {
  const workflow = parse(publishJsrArtifact.content) as {
    permissions: Record<string, string>;
    jobs: Record<string, {
      if: string;
      permissions?: Record<string, string>;
      steps: { run: string }[];
    }>;
  };
  assertEquals(workflow.permissions, { contents: "read", "id-token": "write" });
  const dispatch = workflow.jobs["dispatch-tag"];
  assertEquals(dispatch.permissions, { actions: "write", contents: "read" });
  assertEquals(
    dispatch.if,
    "github.event_name == 'repository_dispatch' && github.sha != github.event.client_payload.releaseSha",
  );
  assertEquals(
    workflow.jobs["publish-jsr"].if,
    "github.event_name == 'workflow_dispatch' || github.sha == github.event.client_payload.releaseSha",
  );
  const root = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-dispatch-",
  });
  try {
    await writeTextFile(
      `${root}/gh`,
      "#!/bin/sh\nprintf '%s\\0' \"$@\"\n",
    );
    await chmod(`${root}/gh`, 0o755);
    const tag = "0.1.0; $(exit 42) `exit 43`";
    const result = await runCommand("sh", {
      args: ["-eu", "-c", dispatch.steps[0].run],
      env: {
        PATH: `${root}:/usr/bin:/bin`,
        GH_REPO: "owner/repo",
        HJ_RELEASE_TAG: tag,
      },
    });
    assertEquals(result.success, true);
    assertEquals(new TextDecoder().decode(result.stdout).split("\0"), [
      "workflow",
      "run",
      "hj-release-publish-jsr.yaml",
      "--repo",
      "owner/repo",
      "--ref",
      tag,
      "-f",
      `tag=${tag}`,
      "",
    ]);
  } finally {
    await remove(root, { recursive: true });
  }
});

test("generated release YAML runs one complete command with quoted output paths", async () => {
  const root = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-workflow-shell-",
  });
  try {
    const executable = `${root}/deno`;
    await writeTextFile(executable, "#!/bin/sh\nprintf '%s\\0' \"$@\"\n");
    await chmod(executable, 0o755);
    const outputPath = `${root}/output with spaces`;
    const summaryPath = `${root}/summary with spaces`;
    const commands: string[] = [];
    for (
      const artifact of [
        publishTagArtifact,
        publishJsrArtifact,
        publishGithubArtifact,
      ]
    ) {
      const workflow = parse(artifact.content) as {
        jobs: Record<string, { steps: { run?: string }[] }>;
      };
      for (const job of Object.values(workflow.jobs)) {
        for (const step of job.steps) {
          if (!step.run?.startsWith("deno run")) continue;
          const result = await runCommand("sh", {
            args: ["-eu", "-c", step.run],
            cwd: root,
            env: {
              PATH: `${root}:/usr/bin:/bin`,
              GITHUB_OUTPUT: outputPath,
              GITHUB_STEP_SUMMARY: summaryPath,
            },
            stdin: "null",
            stdout: "piped",
            stderr: "piped",
          });
          assertEquals(
            result.success,
            true,
            new TextDecoder().decode(result.stderr),
          );
          const args = new TextDecoder().decode(result.stdout).split("\0")
            .filter(Boolean);
          assertEquals(args[0], "run");
          assertEquals(args.includes("--no-lock"), true);
          assertEquals(args.at(-2), "release");
          const command = args.at(-1)!;
          commands.push(command);
          if (command.startsWith("publish-tag-")) {
            const permissions = args.find((arg) =>
              arg.startsWith("--allow-write=")
            )!;
            assertStringIncludes(permissions, summaryPath);
            if (command === "publish-tag-prepare") {
              assertStringIncludes(permissions, outputPath);
            }
          }
          assertEquals(args.filter((arg) => arg.startsWith("jsr:")).length, 1);
        }
      }
    }
    assertEquals(commands, [
      "publish-tag-prepare",
      "publish-tag-apply",
      "publish-jsr",
      "publish-github",
    ]);
  } finally {
    await remove(root, { recursive: true });
  }
});
