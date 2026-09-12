import { sourceFile } from "../testing/runtime-test-fixtures.ts";
import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import {
  makeTempDir,
  remove,
  writeTextFile,
} from "../testing/files-test-fixtures.ts";
import { runRawCommand as runCommand } from "../runtime/command.ts";
import { assertEquals } from "@std/assert";
import { publishTagArtifact } from "./github-release-publish-artifacts.ts";

test("generated preparation permissions let the real version calculator load", async () => {
  const path = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-release-permissions-",
  });
  try {
    const script = `${path}/version.ts`;
    const source = sourceFile("src/release/fork-version.ts").href;
    await writeTextFile(
      script,
      `import { nextVersion } from ${
        JSON.stringify(source)
      };\nconsole.log(await nextVersion("0.0.0", "patch"));\n`,
    );
    const permission = publishTagArtifact.content.match(/--allow-env=\S+/)![0];
    const output = await runCommand("deno", {
      args: [
        "run",
        "--frozen",
        `--config=${sourceFile("deno.json").pathname}`,
        permission,
        script,
      ],
    });
    assertEquals(output.success, true, new TextDecoder().decode(output.stderr));
    assertEquals(new TextDecoder().decode(output.stdout).trim(), "0.0.1");
  } finally {
    await remove(path, { recursive: true });
  }
});

test("generated JSR dry run validates a dirty candidate without creating a commit or tag", async () => {
  const { publishCheckDefinition } = await import("./jsr-package-config.ts");
  const path = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-candidate-check-",
  });
  try {
    await writeTextFile(
      `${path}/deno.json`,
      JSON.stringify({
        name: "@example/scratchpad",
        license: "MIT",
        version: "0.1.0",
        exports: "./mod.ts",
        tasks: { "publish-check": publishCheckDefinition },
      }),
    );
    await writeTextFile(
      `${path}/mod.ts`,
      'export const message = "candidate";\n',
    );
    const initialized = await runCommand("git", {
      args: ["init"],
      cwd: path,
    });
    assertEquals(initialized.success, true);
    const output = await runCommand("deno", {
      args: ["task", "publish-check"],
      cwd: path,
    });
    assertEquals(output.success, true, new TextDecoder().decode(output.stderr));
    const head = await runCommand("git", {
      args: ["rev-parse", "--verify", "HEAD"],
      cwd: path,
    });
    assertEquals(head.success, false);
    const tags = await runCommand("git", {
      args: ["tag", "--list"],
      cwd: path,
    });
    assertEquals(new TextDecoder().decode(tags.stdout), "");
  } finally {
    await remove(path, { recursive: true });
  }
});

test("restricted generated release grants permit selected and nested Deno tasks", async () => {
  const path = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-release-runtime-",
  });
  try {
    const script = `${path}/task.ts`;
    const source = sourceFile("src/runtime/command.ts").href;
    await writeTextFile(
      script,
      `import { runRawCommand as runCommand } from ${JSON.stringify(source)};
const result = await runCommand("deno", { cwd: new URL(${
        JSON.stringify(`file://${path}/`)
      }), args: ["eval", 'const child = await new Deno.Command("deno", { args: ["--version"] }).output(); if (!child.success) throw new Error("nested Deno failed"); console.log("nested task passed")'] });
if (!result.success) throw new Error(new TextDecoder().decode(result.stderr));
console.log(new TextDecoder().decode(result.stdout).trim());\n`,
    );
    const permission = publishTagArtifact.content.match(/--allow-env=\S+/)![0];
    const output = await runCommand("deno", {
      args: [
        "run",
        "--frozen",
        `--config=${sourceFile("deno.json").pathname}`,
        permission,
        "--allow-read=.,/tmp/opencode",
        "--allow-run=deno",
        script,
      ],
      cwd: path,
    });
    assertEquals(output.success, true, new TextDecoder().decode(output.stderr));
    assertEquals(
      new TextDecoder().decode(output.stdout).trim(),
      "nested task passed",
    );
  } finally {
    await remove(path, { recursive: true });
  }
});

test("local runner permissions allow concrete YAML repair previews", async () => {
  const path = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-preview-permissions-",
  });
  try {
    const runner = sourceFile("scripts/run-cli.ts").pathname;
    const read = await runCommand("deno", {
      args: [
        "eval",
        `console.log(Deno.readTextFileSync(${JSON.stringify(runner)}));`,
      ],
    });
    assertEquals(read.success, true, new TextDecoder().decode(read.stderr));
    const permission = new TextDecoder().decode(read.stdout)
      .match(/"(--allow-env=[^"]+)"/)![1];
    const script = `${path}/preview.ts`;
    const source = sourceFile("src/cli/describe-file-repair.ts").href;
    await writeTextFile(
      script,
      `import { describeFileRepair } from ${JSON.stringify(source)};
console.log(describeFileRepair("workflow.yaml", "permissions: read\\n", "permissions: write\\n").join("\\n"));\n`,
    );
    const output = await runCommand("deno", {
      args: [
        "run",
        "--frozen",
        `--config=${sourceFile("deno.json").pathname}`,
        permission,
        script,
      ],
    });
    assertEquals(output.success, true, new TextDecoder().decode(output.stderr));
    assertEquals(
      new TextDecoder().decode(output.stdout).trim(),
      'Update workflow.yaml: permissions = "write".',
    );
  } finally {
    await remove(path, { recursive: true });
  }
});
