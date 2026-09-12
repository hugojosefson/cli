import { test as nativeTest } from "node:test";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { ensureGithubAuthentication } from "./github-authentication.ts";
import { PromptCancelled } from "./prompt-cancelled.ts";
import type { CommandOptions, CommandResult } from "../runtime/command.ts";

const root = new URL("file:///repo/");
const terminal = { input: true, output: true, error: true };
const result = (success: boolean): CommandResult => ({
  success,
  code: success ? 0 : 1,
  stdout: new Uint8Array(),
  stderr: new TextEncoder().encode("private diagnostic"),
});
function runner(outcomes: boolean[]) {
  const calls: CommandOptions[] = [];
  return {
    calls,
    run: (command: string, options: CommandOptions = {}) => {
      assertEquals(command, "gh");
      calls.push(options);
      return Promise.resolve(result(outcomes.shift() ?? false));
    },
  };
}

test("GitHub authentication checks executable and active login without prompting an authenticated user", async () => {
  const mock = runner([true, true]);
  await ensureGithubAuthentication(root, {
    ...mock,
    terminal,
    prompt: () => {
      throw new Error("unexpected prompt");
    },
  });
  assertEquals(mock.calls.map((call) => call.args), [
    ["--version"],
    ["auth", "status", "--active"],
  ]);
  assertEquals(mock.calls[0].cwd, undefined);
});

test("GitHub authentication never prompts with any redirected standard stream", async () => {
  for (const stream of ["input", "output", "error"] as const) {
    const mock = runner([true, false]);
    const error = await assertRejects(() =>
      ensureGithubAuthentication(root, {
        ...mock,
        terminal: { ...terminal, [stream]: false },
        prompt: () => {
          throw new Error("unexpected prompt");
        },
      }), Error);
    assertStringIncludes(error.message, "gh auth login");
    assertStringIncludes(error.message, "GH_TOKEN");
    assertStringIncludes(
      error.message,
      "https://cli.github.com/manual/gh_auth_login",
    );
    assertEquals(error.message.includes("private diagnostic"), false);
    assertEquals(mock.calls.length, 2);
  }
});

test("GitHub login requires explicit consent and rechecks authentication", async () => {
  const mock = runner([true, false, true, true]);
  await ensureGithubAuthentication(root, {
    ...mock,
    terminal,
    prompt: (message) => {
      assertStringIncludes(message, "This operation needs GitHub access");
      return Promise.resolve(" YES ");
    },
  });
  assertEquals(mock.calls[2], {
    args: ["auth", "login"],
    cwd: root,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  assertEquals(mock.calls[3].args, ["auth", "status", "--active"]);
});

test("GitHub login cancellation, refusal and unsuccessful login stop the operation", async () => {
  for (const answer of [null, "", "no"]) {
    const mock = runner([true, false]);
    await assertRejects(() =>
      ensureGithubAuthentication(root, {
        ...mock,
        terminal,
        prompt: () => Promise.resolve(answer),
      }), answer === null ? PromptCancelled : Error);
    assertEquals(mock.calls.length, 2);
  }
  for (const outcomes of [[true, false, false], [true, false, true, false]]) {
    const mock = runner(outcomes);
    await assertRejects(
      () =>
        ensureGithubAuthentication(root, {
          ...mock,
          terminal,
          prompt: () => Promise.resolve("yes"),
        }),
      Error,
      "then retry",
    );
  }
});

test("missing GitHub CLI stops before authentication with an installation link", async () => {
  let calls = 0;
  await assertRejects(
    () =>
      ensureGithubAuthentication(root, {
        run: () => {
          calls++;
          throw Object.assign(new Error("spawn failed"), { code: "ENOENT" });
        },
      }),
    Error,
    "https://cli.github.com/",
  );
  assertEquals(calls, 1);
});
