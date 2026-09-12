import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  parseProjectAutoAdd,
  runProjectAutoAdd,
} from "./run-project-auto-add.ts";
import { runCli } from "./run-cli.ts";
import {
  enabled,
  target,
  template,
} from "../projects/auto-add-test-fixtures.ts";
import type { ProjectPage } from "../projects/browser-connection.ts";

Deno.test("project auto-add validates all arguments before browser access", async () => {
  assertEquals(parseProjectAutoAdd(["--yes"]), {
    method: "auto",
    browserUrl: "ws://127.0.0.1:9222/session",
  });
  assertEquals(
    parseProjectAutoAdd(["--yes", "--method=browser"]).method,
    "browser",
  );
  for (
    const args of [[], ["--yes", "--yes"], ["--yes", "--method=bad"], [
      "--yes",
      "--unknown",
    ], ["--yes", "--browser-url=ws://other.example:9222/session"]]
  ) assertThrows(() => parseProjectAutoAdd(args));
  const help = await runCli(new URL("file:///repo/"), [
    "repo",
    "project-auto-add",
    "--help",
  ]);
  assertEquals(help.output.includes("Firefox"), true);
  await assertRejects(
    () => runCli(new URL("file:///repo/"), ["repo", "project-auto-add"]),
    Error,
    "--yes",
  );
});
Deno.test("project auto-add closes its own tab on success and failure", async () => {
  let closed = 0;
  let failure = false;
  const page: ProjectPage = {
    navigate() {
      return failure
        ? Promise.reject(new Error("connection lost"))
        : Promise.resolve();
    },
    evaluate<T>() {
      return Promise.resolve({
        url: target.projectUrl + "/workflows",
        project: { id: 123, number: 10 },
        privileges: { role: "write" },
        workflows: [enabled],
        configurations: [{
          triggerType: "query_matched",
          defaultWorkflow: template,
        }],
        create: null,
        update: null,
      } as T);
    },
    close() {
      closed++;
      return Promise.resolve();
    },
  };
  const services = {
    target: () => Promise.resolve(target),
    connect: () => Promise.resolve(page),
  };
  const result = await runProjectAutoAdd(
    new URL("file:///repo/"),
    parseProjectAutoAdd(["--yes"]),
    services,
  );
  assertEquals(result, `Auto-add is already enabled: ${target.projectUrl}`);
  failure = true;
  await assertRejects(
    () =>
      runProjectAutoAdd(
        new URL("file:///repo/"),
        parseProjectAutoAdd(["--yes"]),
        services,
      ),
    Error,
    "connection lost",
  );
  assertEquals(closed, 2);
});
