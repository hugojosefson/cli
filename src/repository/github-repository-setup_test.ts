import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { LocalGithubRepositorySetup } from "./github-repository-setup.ts";
import type { GithubCommandResult } from "./github-command.ts";
const bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value));
const ok = (value: unknown): GithubCommandResult => ({
  success: true,
  stdout: bytes(value),
});
const absent: GithubCommandResult = {
  success: false,
  stdout: bytes({ status: "404" }),
  code: 1,
};
const target = {
  owner: "person",
  name: "project",
  visibility: "private" as const,
};

test("repository adapter creates personal and organization repositories without initial files", async () => {
  for (const owner of ["person", "team"]) {
    const calls: { args: readonly string[]; stdin?: string }[] = [];
    const setup = new LocalGithubRepositorySetup({
      run(args, stdin) {
        calls.push({ args, stdin });
        return Promise.resolve(
          args.includes("POST")
            ? ok({ full_name: `${owner}/project`, private: true })
            : args.includes("user")
            ? ok({ login: "person" })
            : absent,
        );
      },
    });
    await setup.create({ ...target, owner });
    assertEquals(calls.length, 3);
    assertEquals(calls[0].args, [
      "api",
      "--hostname",
      "github.com",
      `repos/${owner}/project`,
    ]);
    assertEquals(
      calls[2].args[3],
      owner === "person" ? "user/repos" : "orgs/team/repos",
    );
    assertEquals(JSON.parse(calls[2].stdin!), {
      name: "project",
      private: true,
      auto_init: false,
    });
  }
});

test("repository adapter rejects collisions and unavailable reads before writes", async () => {
  for (
    const response of [ok({ full_name: "person/project" }), {
      success: false,
      stdout: bytes({ status: "403" }),
      stderr: new TextEncoder().encode("secret HTTP 403"),
      code: 1,
    }]
  ) {
    let calls = 0;
    const setup = new LocalGithubRepositorySetup({
      run() {
        calls++;
        return Promise.resolve(response);
      },
    });
    const error = await assertRejects(() => setup.create(target), Error);
    assertEquals(calls, 1);
    assertEquals(error.message.includes("secret"), false);
  }
});

test("repository adapter rejects malformed identity and creation responses", async () => {
  const invalid = new LocalGithubRepositorySetup({
    run: () => Promise.resolve(ok({ login: "../bad" })),
  });
  await assertRejects(() => invalid.viewerLogin(), Error, "Cannot resolve");
  const setup = new LocalGithubRepositorySetup({
    run(args) {
      return Promise.resolve(
        args.includes("POST")
          ? ok({ full_name: "someone/else", private: true })
          : args.includes("user")
          ? ok({ login: "person" })
          : absent,
      );
    },
  });
  await assertRejects(
    () => setup.create(target),
    Error,
    "unexpected repository",
  );
});

test("repository adapter redacts unavailable transport and failed mutations", async () => {
  const unavailable = new LocalGithubRepositorySetup({
    run() {
      throw new Error("secret");
    },
  });
  await assertRejects(
    () => unavailable.viewerLogin(),
    Error,
    "Could not start",
  );
  await assertRejects(
    () => unavailable.assertAbsent(target),
    Error,
    "Could not start",
  );
  let writes = 0;
  const setup = new LocalGithubRepositorySetup({
    run(args) {
      if (args.includes("POST")) {
        writes++;
        return Promise.resolve({
          success: false,
          code: 1,
          stdout: bytes({}),
          stderr: new TextEncoder().encode("token secret HTTP 422"),
        });
      }
      return Promise.resolve(
        args.includes("user") ? ok({ login: "person" }) : absent,
      );
    },
  });
  const error = await assertRejects(() => setup.create(target), Error);
  assertEquals(writes, 1);
  assertStringIncludes(error.message, "HTTP 422");
  assertEquals(error.message.includes("secret"), false);
});
