import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import {
  makeTempDir,
  mkdir,
  readTextFile,
  remove,
  writeTextFile,
} from "../testing/files-test-fixtures.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import metadata from "../../deno.json" with { type: "json" };
import { publishJsrArtifact } from "../features/github-release-publish-artifacts.ts";
import { decodeReleaseBundle } from "./release-bundle.ts";
import {
  localReleaseProcess,
  type ReleaseProcess,
  runOrThrow,
} from "./release-process.ts";
import { publishTagPrepare } from "./publish-tag-prepare.ts";

for (const scenario of ["success", "drifted workflow", "failed contribution"]) {
  test(
    scenario === "success"
      ? "usual preparation creates and outputs a validated candidate bundle"
      : `production preparation rejects ${scenario} without a bundle`,
    async () => {
      const parent = await makeTempDir({
        dir: "/tmp/opencode",
        prefix: "hj-prepare-",
      });
      const root = new URL(`file://${parent}/work/`);
      const remote = `${parent}/remote.git`;
      try {
        await mkdir(root);
        const process = localReleaseProcess(root);
        await runOrThrow(process, "git", ["init", "--bare", remote]);
        await runOrThrow(process, "git", ["init", "--initial-branch=main"]);
        await runOrThrow(process, "git", ["config", "user.name", "Test"]);
        await runOrThrow(process, "git", [
          "config",
          "user.email",
          "test@example.com",
        ]);
        await writeTextFile(
          new URL("deno.json", root),
          '{\n  "version": "0.0.0",\n  "tasks": {\n    "all": "deno eval \'Deno.exit(0)\'"\n  }\n}\n',
        );
        await mkdir(new URL(".github/workflows/", root), { recursive: true });
        await writeTextFile(
          new URL(publishJsrArtifact.path, root),
          publishJsrArtifact.content +
            (scenario === "drifted workflow" ? "\n# externally edited\n" : ""),
        );
        await runOrThrow(process, "git", [
          "add",
          "deno.json",
          publishJsrArtifact.path,
        ]);
        await runOrThrow(process, "git", [
          "commit",
          "-m",
          "feat: initial release",
        ]);
        await runOrThrow(process, "git", ["remote", "add", "origin", remote]);
        await runOrThrow(process, "git", ["push", "-u", "origin", "main"]);
        const outputPath = `${parent}/output`;
        const summaryPath = `${parent}/summary`;
        const values = new Map([
          ["HJ_RELEASE_ROUTE", "usual"],
          ["GITHUB_OUTPUT", outputPath],
          ["GITHUB_STEP_SUMMARY", summaryPath],
        ]);
        assertStringIncludes(
          publishJsrArtifact.content,
          `jsr:${metadata.name}@${metadata.version}`,
        );
        const calls: string[] = [];
        const recordingProcess: ReleaseProcess = {
          run: async (command, args, options) => {
            calls.push(`${command} ${args.join(" ")}`);
            if (command === "deno" && args.join(" ") === "task all") {
              assertEquals(
                JSON.parse(await readTextFile(new URL("deno.json", root)))
                  .version,
                "0.1.0",
              );
              assertStringIncludes(
                await readTextFile(new URL("CHANGELOG.md", root)),
                "### Features\n\n- initial release",
              );
            }
            return command === "deno" &&
                JSON.stringify(args) ===
                  JSON.stringify([
                    "publish",
                    "--dry-run",
                    "--allow-dirty",
                    "--check=all",
                  ])
              ? Promise.resolve({
                success: scenario !== "failed contribution",
                code: scenario === "failed contribution" ? 23 : 0,
                stdout: new Uint8Array(),
                stderr: new Uint8Array(),
              })
              : process.run(command, args, options);
          },
        };
        const prepare = () =>
          publishTagPrepare(
            root,
            {
              get: (
                name,
              ) => (name === "GITHUB_REPOSITORY"
                ? "owner/repo"
                : values.get(name)),
            },
            recordingProcess,
          );
        if (scenario !== "success") {
          await assertRejects(
            prepare,
            Error,
            scenario === "drifted workflow"
              ? "must be exact before release preparation"
              : "Release command failed: deno publish (exit 23)",
          );
          await assertRejects(() => readTextFile(outputPath));
          assertEquals(calls.includes("git diff --name-only -z"), false);
          assertEquals(
            calls.includes("deno publish --dry-run --allow-dirty --check=all"),
            scenario === "failed contribution",
          );
          return;
        }
        const result = await prepare();
        assertEquals(result.releaseNeeded, true);
        const outputs = Object.fromEntries(
          (await readTextFile(outputPath)).trim().split("\n").map((line) => {
            const offset = line.indexOf("=");
            return [line.slice(0, offset), line.slice(offset + 1)];
          }),
        );
        assertEquals(outputs["release-needed"], "true");
        const bundle = await decodeReleaseBundle(
          outputs["release-bundle"],
          outputs["bundle-digest"],
        );
        assertEquals(bundle.previousTag, null);
        assertEquals(bundle.previousVersion, "0.0.0");
        assertEquals(bundle.nextVersion, "0.1.0");
        assertEquals(bundle.releaseType, "minor");
        assertStringIncludes(bundle.changelog.insertion, "initial release");
        assertStringIncludes(await readTextFile(summaryPath), "Release 0.1.0");
        const all = calls.flatMap((call, index) =>
          call === "deno task all" ? [index] : []
        );
        const contribution = calls.indexOf(
          "deno publish --dry-run --allow-dirty --check=all",
        );
        assertEquals(all.length, 1);
        assert(all[0] > calls.indexOf("deno fmt deno.json"));
        assert(contribution > all[0]);
        assert(contribution < calls.indexOf("git diff --name-only -z"));
      } finally {
        await remove(parent, { recursive: true });
      }
    },
  );
}
