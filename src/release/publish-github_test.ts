import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import {
  changelogSection,
  type GithubRelease,
  githubReleaseApi,
  publishGithub,
} from "./publish-github.ts";
import {
  environment,
  files,
  ok,
  process,
  sha,
} from "./publisher-test-fixtures.ts";
const expected: GithubRelease = {
  tag_name: "1.2.3",
  target_commitish: sha,
  name: "1.2.3",
  body: "## 1.2.3\nnotes\n",
  draft: false,
  prerelease: false,
};
Deno.test("GitHub publisher handles exact, conflict, and absent uncertain rereads", async () => {
  const base = () =>
    process([], { "git show HEAD:CHANGELOG.md": expected.body });
  for (const reread of [expected, { ...expected, body: "x" }, undefined]) {
    const values = [undefined, reread];
    await (reread === undefined || reread.body === "x"
      ? assertRejects(
        () =>
          publishGithub({
            environment: environment(),
            process: base(),
            files: files(),
            api: {
              read: () => Promise.resolve(values.shift()),
              create: () => Promise.reject(new Error()),
            },
          }),
        Error,
      )
      : publishGithub({
        environment: environment(),
        process: base(),
        files: files(),
        api: {
          read: () => Promise.resolve(values.shift()),
          create: () => Promise.reject(new Error()),
        },
      }));
  }
});
Deno.test("GitHub publisher reuses exact releases and rejects existing drift", async () => {
  let creates = 0;
  await publishGithub({
    environment: environment(),
    process: process([], { "git show HEAD:CHANGELOG.md": expected.body }),
    files: files(),
    api: {
      read: () => Promise.resolve(expected),
      create: () => {
        creates++;
        return Promise.resolve();
      },
    },
  });
  assertEquals(creates, 0);
  await assertRejects(() =>
    publishGithub({
      environment: environment(),
      process: process([], { "git show HEAD:CHANGELOG.md": expected.body }),
      files: files(),
      api: {
        read: () => Promise.resolve({ ...expected, body: "drift" }),
        create: () => Promise.resolve(),
      },
    }), TypeError);
});
Deno.test("GitHub publisher marks only SemVer prereleases", async () => {
  for (
    const [version, prerelease] of [
      ["1.2.3", false],
      ["1.2.3-rc.1", true],
      ["1.2.3+build.1", false],
    ] as const
  ) {
    let created: GithubRelease | undefined;
    const release = {
      ...expected,
      tag_name: version,
      name: version,
      body: `## ${version}\nnotes\n`,
      prerelease,
    };
    await publishGithub({
      environment: environment({
        HJ_RELEASE_TAG: version,
        HJ_RELEASE_VERSION: version,
      }),
      process: process([], {
        [`git ls-remote origin refs/tags/${version} refs/tags/${version}^{}`]:
          `${sha}\trefs/tags/${version}\n`,
        "git show HEAD:CHANGELOG.md": release.body,
      }),
      files: files(`{"version":"${version}"}`),
      api: {
        read: () => Promise.resolve(created),
        create: (value) => {
          created = value;
          return Promise.resolve();
        },
      },
    });
    assertEquals(created, release);
  }
});
Deno.test("GitHub API validates statuses, JSON, encoding, and process success", async () => {
  const calls: Array<{ args: readonly string[]; stdin?: string }> = [];
  const api = githubReleaseApi({
    run: (_c, args, options) => {
      calls.push({ args, stdin: options?.stdin });
      return Promise.resolve(
        ok(
          `HTTP/1.1 ${calls.length === 1 ? 404 : 201} OK\nX: y\n\n${
            JSON.stringify(expected)
          }`,
        ),
      );
    },
  }, "owner/repo");
  assertEquals(await api.read("1.2.3"), undefined);
  await api.create(expected);
  assertEquals(calls[1].args.join(" ").includes("token"), false);
  assertEquals(calls[1].stdin!.includes("token"), false);
  const encodedCalls: string[][] = [];
  const encoded = githubReleaseApi({
    run: (_command, args) => {
      encodedCalls.push([...args]);
      return Promise.resolve(
        ok(`HTTP/2 404 Not Found\r\nX: y\r\n\r\n${JSON.stringify({})}`),
      );
    },
  }, "owner/repo");
  assertEquals(await encoded.read("1.2.3+build/a"), undefined);
  assertStringIncludes(
    encodedCalls[0].join(" "),
    "repos/owner/repo/releases/tags/1.2.3%2Bbuild%2Fa",
  );
  for (
    const response of [
      "HTTP/1.1 200 OK\nX: y\n\n{",
      "HTTP/1.1 200 OK\nX: y\n\n[]",
      "bad",
    ]
  ) {
    await assertRejects(() =>
      githubReleaseApi(
        { run: () => Promise.resolve(ok(response)) },
        "owner/repo",
      ).read("a/b c")
    );
  }
  for (
    const [status, success] of [[500, true], [200, false]] as const
  ) {
    await assertRejects(() =>
      githubReleaseApi({
        run: () =>
          Promise.resolve({
            ...ok(
              `HTTP/1.1 ${status} Error\nX: y\n\n${JSON.stringify(expected)}`,
            ),
            success,
            code: success ? 0 : 1,
          }),
      }, "owner/repo").read("1.2.3"), Error);
  }
  for (
    const [status, success] of [[200, true], [201, false]] as const
  ) {
    await assertRejects(() =>
      githubReleaseApi({
        run: () =>
          Promise.resolve({
            ...ok(
              `HTTP/1.1 ${status} Error\nX: y\n\n${JSON.stringify(expected)}`,
            ),
            success,
            code: success ? 0 : 1,
          }),
      }, "owner/repo").create(expected), Error);
  }
});
Deno.test("GitHub changelog sections reject missing and duplicate data", () => {
  for (const text of ["", "## 1.2.3\na\n## 1.2.3\nb\n"]) {
    let threw = false;
    try {
      changelogSection(text, "1.2.3");
    } catch {
      threw = true;
    }
    assertEquals(threw, true);
  }
  assertEquals(
    changelogSection(
      "# Changelog\n\n## 1.2.3\nnotes\n\n### Detail\nmore\n\n## 1.2.2\nold\n",
      "1.2.3",
    ),
    "## 1.2.3\nnotes\n\n### Detail\nmore\n\n",
  );
});
