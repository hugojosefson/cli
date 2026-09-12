import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import { makeTempDir, mkdir, remove } from "../testing/files-test-fixtures.ts";
import { assertEquals, assertRejects } from "@std/assert";
import {
  localPublisherFiles,
  publisherInput,
  versionConfig,
} from "./publisher-input.ts";
import {
  createGitSymlink,
  encoder,
  environment,
  process,
  sha,
} from "./publisher-test-fixtures.ts";

test("publisher input validates all event fields before process", async () => {
  for (
    const invalid of [
      { HJ_RELEASE_ROUTE: undefined },
      { HJ_RELEASE_ROUTE: "bad" },
      { GITHUB_REPOSITORY: undefined },
      { GITHUB_REPOSITORY: "o/../r" },
      { HJ_RELEASE_SCHEMA: undefined },
      { HJ_RELEASE_SCHEMA: "2" },
      { HJ_RELEASE_TAG: undefined },
      { HJ_RELEASE_TAG: "v1.2.3" },
      { HJ_RELEASE_VERSION: undefined },
      { HJ_RELEASE_VERSION: "1.2.4" },
      { HJ_RELEASE_VERSION: "01.2.3" },
      { HJ_RELEASE_SHA: undefined },
      { HJ_RELEASE_SHA: "A".repeat(40) },
    ]
  ) {
    const calls: string[] = [];
    await assertRejects(
      () => publisherInput(environment(invalid), process(calls)),
      TypeError,
    );
    assertEquals(calls, []);
  }
  const calls: string[] = [];
  assertEquals(
    await publisherInput(
      environment({
        HJ_RELEASE_ROUTE: "user",
        HJ_RELEASE_SCHEMA: undefined,
        HJ_RELEASE_VERSION: undefined,
        HJ_RELEASE_SHA: undefined,
      }),
      process(calls),
    ),
    {
      route: "user",
      repository: "owner/repo",
      tag: "1.2.3",
      version: "1.2.3",
      sha,
    },
  );
});
test("publisher input rejects all non-lightweight tags and checkout drift", async () => {
  for (
    const tag of [
      "",
      `${sha}\trefs/tags/1.2.3^{}\n`,
      `${sha}\trefs/tags/1.2.3\n${sha}\trefs/tags/1.2.3^{}\n`,
      `${sha}\trefs/tags/other\n`,
      "bad\n",
    ]
  ) {
    await assertRejects(() =>
      publisherInput(
        environment(),
        process([], {
          "git ls-remote origin refs/tags/1.2.3 refs/tags/1.2.3^{}": tag,
        }),
      ), TypeError);
  }
  await assertRejects(
    () =>
      publisherInput(
        environment(),
        process([], { "git rev-parse HEAD^{commit}": `${"b".repeat(40)}\n` }),
      ),
    TypeError,
  );
});
test("version config rejects invalid kinds and accepts JSONC", async () => {
  const observe = (a: unknown, b: unknown) => ({
    observe: (path: "deno.json" | "deno.jsonc") =>
      Promise.resolve((path === "deno.json" ? a : b) as never),
  });
  for (
    const pair of [
      [{ kind: "absent" }, { kind: "absent" }],
      [{ kind: "other" }, { kind: "absent" }],
      [{ kind: "file", bytes: encoder.encode("{}") }, {
        kind: "file",
        bytes: encoder.encode("{}"),
      }],
      [{ kind: "file", bytes: encoder.encode("{") }, { kind: "absent" }],
      [{ kind: "file", bytes: encoder.encode("[]") }, { kind: "absent" }],
      [{ kind: "file", bytes: encoder.encode('{"version":"1"}') }, {
        kind: "absent",
      }],
    ]
  ) {
    await assertRejects(
      () => versionConfig(observe(pair[0], pair[1]), "1.2.3"),
      TypeError,
    );
  }
  assertEquals(
    await versionConfig(
      observe({ kind: "absent" }, {
        kind: "file",
        bytes: encoder.encode('//x\n{"version":"1.2.3",}'),
      }),
      "1.2.3",
    ),
    { version: "1.2.3" },
  );
});
test("local publisher files reject directory and symlink", async () => {
  const root = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "publisher-",
  });
  try {
    await mkdir(`${root}/deno.json`);
    await createGitSymlink(
      new URL(`file://${root}/`),
      "deno.jsonc",
      "deno.json",
    );
    const reader = localPublisherFiles(new URL(`file://${root}/`));
    assertEquals((await reader.observe("deno.json")).kind, "other");
    assertEquals((await reader.observe("deno.jsonc")).kind, "other");
  } finally {
    await remove(root, { recursive: true });
  }
});
