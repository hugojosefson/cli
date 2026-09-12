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
import { publishJsrArtifact } from "../features/github-release-publish-artifacts.ts";
import { decodeReleaseBundle } from "./release-bundle.ts";
import {
  localReleaseProcess,
  type ReleaseProcess,
  runOrThrow,
} from "./release-process.ts";
import { publishTagPrepare } from "./publish-tag-prepare.ts";
import { validateSourceCommitRange } from "./source-commit-validation.ts";

test("source validation checks every commit in the base-to-head range", async () => {
  await withRepository(async (root, process) => {
    await writeTextFile(new URL("one.txt", root), "one\n");
    await runOrThrow(process, "git", ["add", "one.txt"]);
    await runOrThrow(process, "git", ["commit", "-m", "feat: add one"]);
    const base = (await runOrThrow(process, "git", ["rev-parse", "HEAD"]))
      .trim();
    await writeTextFile(new URL("two.txt", root), "two\n");
    await runOrThrow(process, "git", ["add", "two.txt"]);
    await runOrThrow(process, "git", ["commit", "-m", "invalid message"]);
    const head = (await runOrThrow(process, "git", ["rev-parse", "HEAD"]))
      .trim();
    await assertRejects(() => validateSourceCommitRange(process, base, head));
  });
});

test("source validation checks only commits added by a diverged head", async () => {
  await withRepository(async (root, process) => {
    const common = (await runOrThrow(process, "git", ["rev-parse", "HEAD"]))
      .trim();
    await writeTextFile(new URL("base-only.txt", root), "base\n");
    await runOrThrow(process, "git", ["add", "base-only.txt"]);
    await runOrThrow(process, "git", ["commit", "-m", "invalid base message"]);
    const base = (await runOrThrow(process, "git", ["rev-parse", "HEAD"]))
      .trim();
    await runOrThrow(process, "git", ["switch", "--detach", common]);
    await writeTextFile(new URL("head.txt", root), "head\n");
    await runOrThrow(process, "git", ["add", "head.txt"]);
    await runOrThrow(process, "git", ["commit", "-m", "feat: valid head"]);
    const validHead = (await runOrThrow(process, "git", ["rev-parse", "HEAD"]))
      .trim();
    await validateSourceCommitRange(process, base, validHead);
    await writeTextFile(new URL("bad.txt", root), "bad\n");
    await runOrThrow(process, "git", ["add", "bad.txt"]);
    await runOrThrow(process, "git", ["commit", "-m", "invalid head message"]);
    const invalidHead = (await runOrThrow(process, "git", [
      "rev-parse",
      "HEAD",
    ])).trim();
    await assertRejects(() =>
      validateSourceCommitRange(process, base, invalidHead)
    );
  });
});

test("usual preparation creates and outputs a validated candidate bundle", async () => {
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
      publishJsrArtifact.content,
    );
    await runOrThrow(process, "git", [
      "add",
      "deno.json",
      publishJsrArtifact.path,
    ]);
    await runOrThrow(process, "git", ["commit", "-m", "feat: initial release"]);
    await runOrThrow(process, "git", ["remote", "add", "origin", remote]);
    await runOrThrow(process, "git", ["push", "-u", "origin", "main"]);
    const outputPath = `${parent}/output`;
    const summaryPath = `${parent}/summary`;
    const values = new Map([
      ["HJ_RELEASE_ROUTE", "usual"],
      ["GITHUB_OUTPUT", outputPath],
      ["GITHUB_STEP_SUMMARY", summaryPath],
    ]);
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
            "feat: initial release",
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
            success: true,
            code: 0,
            stdout: new Uint8Array(),
            stderr: new Uint8Array(),
          })
          : process.run(command, args, options);
      },
    };
    const result = await publishTagPrepare(
      root,
      { get: (name) => values.get(name) },
      recordingProcess,
    );
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
    assertStringIncludes(bundle.changelog.insertion, "feat: initial release");
    assertStringIncludes(await readTextFile(summaryPath), "Release 0.1.0");
    const all = calls.flatMap((call, index) =>
      call === "deno task all" ? [index] : []
    );
    const contribution = calls.indexOf(
      "deno publish --dry-run --allow-dirty --check=all",
    );
    assertEquals(all.length, 1);
    assert(all[0] > calls.indexOf("deno fmt deno.json CHANGELOG.md"));
    assert(contribution > all[0]);
    assert(contribution < calls.indexOf("git diff --name-only -z"));
  } finally {
    await remove(parent, { recursive: true });
  }
});

test("recovery rebuilds a first release with or without its lightweight tag", async () => {
  for (const tagged of [false, true]) {
    await withPreparedRelease(async (root, process, parent) => {
      if (tagged) {
        await runOrThrow(process, "git", ["tag", "0.1.0"]);
        await runOrThrow(process, "git", ["push", "origin", "0.1.0"]);
      }
      const output = `${parent}/recovery-output-${tagged}`;
      const values = new Map([
        ["HJ_RELEASE_ROUTE", "recovery"],
        ["HJ_RELEASE_TAG", "0.1.0"],
        ["GITHUB_OUTPUT", output],
      ]);
      const result = await publishTagPrepare(root, {
        get: (name) => values.get(name),
      }, process);
      assertEquals(result.releaseNeeded, true);
      const entries = Object.fromEntries(
        (await readTextFile(output)).trim().split("\n").map((line) => {
          const offset = line.indexOf("=");
          return [line.slice(0, offset), line.slice(offset + 1)];
        }),
      );
      const bundle = await decodeReleaseBundle(
        entries["release-bundle"],
        entries["bundle-digest"],
      );
      assertEquals(bundle.previousTag, null);
      assertEquals(bundle.nextVersion, "0.1.0");
    });
  }
});

test("candidate validation failures and mutations cannot produce a release bundle", async () => {
  for (const outcome of ["failure", "deno.json", "CHANGELOG.md", "extra.txt"]) {
    await withReleaseSource(async (root, process, parent) => {
      const output = `${parent}/failed-output`;
      let validations = 0;
      const guardedProcess: ReleaseProcess = {
        async run(command, args, options) {
          if (command === "deno" && args.join(" ") === "task all") {
            validations++;
            assertEquals(
              JSON.parse(await readTextFile(new URL("deno.json", root)))
                .version,
              "0.1.0",
            );
            if (outcome !== "failure") {
              await writeTextFile(new URL(outcome, root), "changed\n");
            }
            return {
              success: outcome !== "failure",
              code: outcome === "failure" ? 1 : 0,
              stdout: new Uint8Array(),
              stderr: new Uint8Array(),
            };
          }
          return await process.run(command, args, options);
        },
      };
      await assertRejects(
        () =>
          publishTagPrepare(root, {
            get: (name) =>
              name === "HJ_RELEASE_ROUTE"
                ? "usual"
                : name === "GITHUB_OUTPUT"
                ? output
                : undefined,
          }, guardedProcess),
        Error,
        outcome === "failure"
          ? "Release command failed: deno task"
          : outcome === "extra.txt"
          ? "Release preparation changed an unexpected path."
          : "Candidate validation changed release data.",
      );
      assertEquals(validations, 1);
      await assertRejects(() => readTextFile(output));
    });
  }
});

test("usual preparation directs an untagged correct release to tag recovery", async () => {
  await withPreparedRelease(async (root, process) => {
    const values = new Map([["HJ_RELEASE_ROUTE", "usual"]]);
    await assertRejects(
      () =>
        publishTagPrepare(root, { get: (name) => values.get(name) }, process),
      Error,
      "start the tag workflow with 0.1.0",
    );
  });
});

test("recovery rejects a release with one changed tree byte", async () => {
  await withPreparedRelease(async (root, process) => {
    const previous = (await runOrThrow(process, "git", ["rev-parse", "HEAD"]))
      .trim();
    await writeTextFile(new URL("CHANGELOG.md", root), "tampered\n", {
      flag: "a",
    });
    await runOrThrow(process, "git", ["add", "CHANGELOG.md"]);
    await runOrThrow(process, "git", ["commit", "--amend", "--no-edit"]);
    await runOrThrow(process, "git", [
      "push",
      `--force-with-lease=refs/heads/main:${previous}`,
      "origin",
      "HEAD:main",
    ]);
    await assertRejects(
      () => recovery(root, process),
      Error,
      "tree differs",
    );
  });
});

test("recovery rejects annotated and wrong-target same-name tags", async () => {
  for (const kind of ["annotated", "wrong-target"] as const) {
    await withPreparedRelease(async (root, process) => {
      const command = kind === "annotated"
        ? ["tag", "-a", "0.1.0", "-m", "test"]
        : ["tag", "0.1.0", "HEAD^"];
      await runOrThrow(process, "git", command);
      await runOrThrow(process, "git", ["push", "origin", "0.1.0"]);
      await assertRejects(
        () => recovery(root, process),
        Error,
      );
    });
  }
});

test("usual history scan restores between tagged and untagged releases", async () => {
  await withPreparedRelease(async (root, process) => {
    await runOrThrow(process, "git", ["tag", "0.1.0"]);
    await runOrThrow(process, "git", ["push", "origin", "0.1.0"]);
    await writeTextFile(new URL("feature.txt", root), "next\n");
    await runOrThrow(process, "git", ["add", "feature.txt"]);
    await runOrThrow(process, "git", ["commit", "-m", "feat: next"]);
    await runOrThrow(process, "git", ["push", "origin", "HEAD:main"]);
    await publishTagPrepare(root, {
      get: (name) => name === "HJ_RELEASE_ROUTE" ? "usual" : undefined,
    }, process);
    await runOrThrow(process, "git", ["add", "deno.json", "CHANGELOG.md"]);
    await runOrThrow(process, "git", ["commit", "-m", "chore(release): 0.2.0"]);
    await runOrThrow(process, "git", ["push", "origin", "HEAD:main"]);
    await assertRejects(
      () => publishTagPrepare(root, { get: () => "usual" }, process),
      Error,
      "start the tag workflow with 0.2.0",
    );
  });
});

async function recovery(
  root: URL,
  process: ReturnType<typeof localReleaseProcess>,
): Promise<unknown> {
  return await publishTagPrepare(
    root,
    {
      get: (name) =>
        name === "HJ_RELEASE_ROUTE"
          ? "recovery"
          : name === "HJ_RELEASE_TAG"
          ? "0.1.0"
          : undefined,
    },
    process,
  );
}

async function withPreparedRelease(
  action: (
    root: URL,
    process: ReturnType<typeof localReleaseProcess>,
    parent: string,
  ) => Promise<void>,
): Promise<void> {
  await withReleaseSource(async (root, process, parent) => {
    await publishTagPrepare(root, {
      get: (name) => name === "HJ_RELEASE_ROUTE" ? "usual" : undefined,
    }, process);
    await runOrThrow(process, "git", ["add", "deno.json", "CHANGELOG.md"]);
    await runOrThrow(process, "git", ["commit", "-m", "chore(release): 0.1.0"]);
    await runOrThrow(process, "git", ["push", "origin", "HEAD:main"]);
    await action(root, process, parent);
  });
}

async function withReleaseSource(
  action: (
    root: URL,
    process: ReturnType<typeof localReleaseProcess>,
    parent: string,
  ) => Promise<void>,
): Promise<void> {
  const parent = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-recovery-",
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
      '{"version":"0.0.0","tasks":{"all":"deno eval \'Deno.exit(0)\'"}}\n',
    );
    await runOrThrow(process, "git", ["add", "deno.json"]);
    await runOrThrow(process, "git", ["commit", "-m", "feat: initial release"]);
    await runOrThrow(process, "git", ["remote", "add", "origin", remote]);
    await runOrThrow(process, "git", ["push", "-u", "origin", "main"]);
    await action(root, process, parent);
  } finally {
    await remove(parent, { recursive: true });
  }
}

async function withRepository(
  action: (
    root: URL,
    process: ReturnType<typeof localReleaseProcess>,
  ) => Promise<void>,
): Promise<void> {
  const path = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-source-validation-",
  });
  const root = new URL(`file://${path}/`);
  try {
    const process = localReleaseProcess(root);
    await runOrThrow(process, "git", ["init", "--initial-branch=main"]);
    await runOrThrow(process, "git", ["config", "user.name", "Test"]);
    await runOrThrow(process, "git", [
      "config",
      "user.email",
      "test@example.com",
    ]);
    await writeTextFile(new URL("base.txt", root), "base\n");
    await runOrThrow(process, "git", ["add", "base.txt"]);
    await runOrThrow(process, "git", ["commit", "-m", "chore: base"]);
    await action(root, process);
  } finally {
    await remove(path, { recursive: true });
  }
}
