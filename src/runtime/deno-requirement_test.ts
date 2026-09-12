import { test } from "node:test";
import { runCommand } from "./command.ts";
import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  acceptsDeno,
  denoRequirement,
  exactDenoVersion,
  projectDenoRequirement,
} from "./deno-requirement.ts";
import {
  currentDenoOptions,
  parseDenoOptions,
  withDenoOptions,
} from "./deno-options.ts";

test("Deno requirements preserve exact pins and stable same-major bounds", () => {
  for (const value of ["2.9.6", "2.10.0-rc.1"]) {
    const requirement = denoRequirement(value);
    assert(acceptsDeno(requirement, value));
    assertEquals(acceptsDeno(requirement, "2.9.7"), false);
  }
  for (const range of ["^2.9.6", ">=2.9.6 <3"]) {
    const requirement = denoRequirement(range, "2.9.6");
    assert(acceptsDeno(requirement, "2.10.1"));
    for (const version of ["2.9.5", "3.0.0", "2.10.0-rc.1", "garbage"]) {
      assertEquals(acceptsDeno(requirement, version), false);
    }
  }
  for (const range of ["~2.9.6", "2.9.x", ">=2.9.6 <2.10.0"]) {
    assert(acceptsDeno(denoRequirement(range), "2.9.8"));
    assertEquals(acceptsDeno(denoRequirement(range), "2.10.0"), false);
  }
  for (
    const range of [
      "*",
      ">=2.9.6",
      ">=2.9.6 <4",
      ">=2.9.6 <2.0.0",
      "^0.9.6",
      "~2.09.6",
      "2.9",
      "^2.10.0-rc.1",
    ]
  ) assertThrows(() => denoRequirement(range));
  for (
    const value of [null, 2, "02.9.6", "2.9.6+custom", "99999999999999999.0.0"]
  ) assertEquals(exactDenoVersion(value), false);
  assertThrows(() => denoRequirement("2.9.6", "2.9.8"));
  assertThrows(() => denoRequirement("^2.9.6", "3.0.0"));
  assertThrows(() => denoRequirement("^2.9.6", "2.10.0-rc.1"));
});

test("project Deno declarations are exclusive, guarded, and scoped to the given directory", async () => {
  const directory = await fs.mkdtemp("/tmp/opencode/hj-deno-requirement-");
  const root = pathToFileURL(directory + "/");
  try {
    assertEquals((await projectDenoRequirement(root, {})).preferred, "2.9.6");
    await fs.writeFile(join(directory, ".deno-version"), "2.10.2\n");
    assertEquals((await projectDenoRequirement(root, {})).exact, "2.10.2");
    await fs.mkdir(join(directory, "subdir"));
    assertEquals(
      (await projectDenoRequirement(new URL("subdir/", root), {})).preferred,
      "2.9.6",
    );
    await fs.mkdir(join(directory, ".hj"));
    const config = join(directory, ".hj/deno-runtime.json");
    await fs.writeFile(
      config,
      JSON.stringify({ range: "2.10.x", preferred: "2.10.2" }),
    );
    await assertRejects(
      () => projectDenoRequirement(root, {}),
      Error,
      "not both",
    );
    assertEquals(
      (await projectDenoRequirement(root, { requirement: "2.9.6" })).exact,
      "2.9.6",
    );
    await fs.rm(join(directory, ".deno-version"));
    assertEquals((await projectDenoRequirement(root, {})).preferred, "2.10.2");
    for (
      const value of [
        "broken",
        "[]",
        '{"range":2}',
        '{"range":"2.9.6"}',
        '{"range":"^2.9.6","preferred":3}',
        '{"range":"^2.9.6","unknown":true}',
      ]
    ) {
      await fs.writeFile(config, value);
      await assertRejects(() => projectDenoRequirement(root, {}));
    }
    await fs.rm(config);
    await runCommand("sh", {
      args: ["-c", 'ln -s "$1" "$2"', "sh", "../subdir", config],
    });
    await assertRejects(
      () => projectDenoRequirement(root, {}),
      Error,
      "regular file",
    );
    await fs.rm(config);
    await fs.writeFile(join(directory, ".deno-version"), "^2.9.6\n");
    await assertRejects(
      () => projectDenoRequirement(root, {}),
      Error,
      "one exact",
    );
  } finally {
    await fs.rm(directory, { recursive: true });
  }
});

test("local runtime flags leave workflow choices and positional arguments intact", async () => {
  assertEquals(
    parseDenoOptions([
      "repo",
      "features",
      "--deno-version=2.9.6",
      "--runtime-deno=2.10.x",
      "--runtime-deno-preferred=2.10.2",
      "--offline",
    ]),
    {
      args: ["repo", "features", "--deno-version=2.9.6"],
      options: { requirement: "2.10.x", preferred: "2.10.2", offline: true },
    },
  );
  assertEquals(parseDenoOptions(["--", "--offline"]).args, ["--", "--offline"]);
  for (
    const args of [
      ["--offline", "--offline"],
      ["--runtime-deno="],
      ["--runtime-deno"],
      ["--runtime-deno=2.9.6", "--runtime-deno=2.9.8"],
      ["--runtime-deno-preferred=2.9.6"],
      ["--runtime-deno-preferred="],
      ["--runtime-deno-preferred=2", "--runtime-deno-preferred=3"],
    ]
  ) assertThrows(() => parseDenoOptions(args));
  await Promise.all(
    ["2.9.6", "2.10.2"].map((requirement) =>
      withDenoOptions({ requirement }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        assertEquals(currentDenoOptions().requirement, requirement);
      })
    ),
  );
  assertEquals(currentDenoOptions(), {});
});
