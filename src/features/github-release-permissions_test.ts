import { assertEquals } from "@std/assert";
import { publishTagArtifact } from "./github-release-publish-artifacts.ts";

Deno.test("generated preparation permissions let the real version calculator load", async () => {
  const path = await Deno.makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-release-permissions-",
  });
  try {
    const script = `${path}/version.ts`;
    const source = new URL("../release/fork-version.ts", import.meta.url).href;
    await Deno.writeTextFile(
      script,
      `import { nextVersion } from ${
        JSON.stringify(source)
      };\nconsole.log(await nextVersion("0.0.0", "patch"));\n`,
    );
    const permission = publishTagArtifact.content.match(/--allow-env=\S+/)![0];
    const output = await new Deno.Command("deno", {
      args: [
        "run",
        "--frozen",
        `--config=${new URL("../../deno.json", import.meta.url).pathname}`,
        permission,
        script,
      ],
    }).output();
    assertEquals(output.success, true, new TextDecoder().decode(output.stderr));
    assertEquals(new TextDecoder().decode(output.stdout).trim(), "0.0.1");
  } finally {
    await Deno.remove(path, { recursive: true });
  }
});

Deno.test("generated JSR dry run validates a dirty candidate without creating a commit or tag", async () => {
  const { publishCheckDefinition } = await import("./jsr-package-config.ts");
  const path = await Deno.makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-candidate-check-",
  });
  try {
    await Deno.writeTextFile(
      `${path}/deno.json`,
      JSON.stringify({
        name: "@example/scratchpad",
        license: "MIT",
        version: "0.1.0",
        exports: "./mod.ts",
        tasks: { "publish-check": publishCheckDefinition },
      }),
    );
    await Deno.writeTextFile(
      `${path}/mod.ts`,
      'export const message = "candidate";\n',
    );
    const initialized = await new Deno.Command("git", {
      args: ["init"],
      cwd: path,
    }).output();
    assertEquals(initialized.success, true);
    const output = await new Deno.Command("deno", {
      args: ["task", "publish-check"],
      cwd: path,
    }).output();
    assertEquals(output.success, true, new TextDecoder().decode(output.stderr));
    const head = await new Deno.Command("git", {
      args: ["rev-parse", "--verify", "HEAD"],
      cwd: path,
    }).output();
    assertEquals(head.success, false);
    const tags = await new Deno.Command("git", {
      args: ["tag", "--list"],
      cwd: path,
    }).output();
    assertEquals(new TextDecoder().decode(tags.stdout), "");
  } finally {
    await Deno.remove(path, { recursive: true });
  }
});

Deno.test("restricted generated release grants permit selected and nested Deno tasks", async () => {
  const path = await Deno.makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-release-runtime-",
  });
  try {
    const script = `${path}/task.ts`;
    const source = new URL("../runtime/command.ts", import.meta.url).href;
    await Deno.writeTextFile(
      script,
      `import { runCommand } from ${JSON.stringify(source)};
const result = await runCommand("deno", { cwd: new URL(${
        JSON.stringify(`file://${path}/`)
      }), args: ["eval", 'const child = await new Deno.Command("deno", { args: ["--version"] }).output(); if (!child.success) throw new Error("nested Deno failed"); console.log("nested task passed")'] });
if (!result.success) throw new Error(new TextDecoder().decode(result.stderr));
console.log(new TextDecoder().decode(result.stdout).trim());\n`,
    );
    const permission = publishTagArtifact.content.match(/--allow-env=\S+/)![0];
    const output = await new Deno.Command("deno", {
      args: [
        "run",
        "--frozen",
        `--config=${new URL("../../deno.json", import.meta.url).pathname}`,
        permission,
        "--allow-read=.,/tmp/opencode",
        "--allow-run=deno",
        script,
      ],
      cwd: path,
    }).output();
    assertEquals(output.success, true, new TextDecoder().decode(output.stderr));
    assertEquals(
      new TextDecoder().decode(output.stdout).trim(),
      "nested task passed",
    );
  } finally {
    await Deno.remove(path, { recursive: true });
  }
});

Deno.test("local runner permissions allow concrete YAML repair previews", async () => {
  const path = await Deno.makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-preview-permissions-",
  });
  try {
    const runner =
      new URL("../../scripts/run-cli.ts", import.meta.url).pathname;
    const read = await new Deno.Command("deno", {
      args: [
        "eval",
        `console.log(Deno.readTextFileSync(${JSON.stringify(runner)}));`,
      ],
    }).output();
    assertEquals(read.success, true, new TextDecoder().decode(read.stderr));
    const permission = new TextDecoder().decode(read.stdout)
      .match(/"(--allow-env=[^"]+)"/)![1];
    const script = `${path}/preview.ts`;
    const source =
      new URL("../cli/describe-file-repair.ts", import.meta.url).href;
    await Deno.writeTextFile(
      script,
      `import { describeFileRepair } from ${JSON.stringify(source)};
console.log(describeFileRepair("workflow.yaml", "permissions: read\\n", "permissions: write\\n").join("\\n"));\n`,
    );
    const output = await new Deno.Command("deno", {
      args: [
        "run",
        "--frozen",
        `--config=${new URL("../../deno.json", import.meta.url).pathname}`,
        permission,
        script,
      ],
    }).output();
    assertEquals(output.success, true, new TextDecoder().decode(output.stderr));
    assertEquals(
      new TextDecoder().decode(output.stdout).trim(),
      'Update workflow.yaml: permissions = "write".',
    );
  } finally {
    await Deno.remove(path, { recursive: true });
  }
});
