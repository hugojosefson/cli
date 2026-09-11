import { assertEquals, assertStringIncludes } from "@std/assert";
import { parse } from "yaml";
import {
  publishGithubArtifact,
  publishJsrArtifact,
  publishTagArtifact,
} from "./github-release-publish-artifacts.ts";

Deno.test("generated release YAML runs one complete command with quoted output paths", async () => {
  const root = await Deno.makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-workflow-shell-",
  });
  try {
    const executable = `${root}/deno`;
    await Deno.writeTextFile(executable, "#!/bin/sh\nprintf '%s\\0' \"$@\"\n");
    await Deno.chmod(executable, 0o755);
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
          const result = await new Deno.Command("sh", {
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
          }).output();
          assertEquals(
            result.success,
            true,
            new TextDecoder().decode(result.stderr),
          );
          const args = new TextDecoder().decode(result.stdout).split("\0")
            .filter(Boolean);
          assertEquals(args[0], "run");
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
    await Deno.remove(root, { recursive: true });
  }
});
