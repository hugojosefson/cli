import { test as nativeTest } from "node:test";
import { delimiter, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { assertEquals } from "@std/assert";
import { trackTests } from "../testing/inventory-test-fixtures.ts";
import { nativeValidationSummary } from "./native-validation-summary.ts";
import {
  captureSummaryTask,
  nativeSummaryFixture,
} from "./native-validation-summary-test-fixtures.ts";
import { externalDeno } from "../testing/runtime-test-fixtures.ts";
import {
  makeTempDir,
  remove,
  writeTextFile,
} from "../testing/files-test-fixtures.ts";
const test = trackTests(import.meta.url, nativeTest);
const line = (value: unknown) =>
  `Native input summary: ${JSON.stringify(value)}\n`;

test("release summaries survive Deno task capture with color settings", async () => {
  const directory = await makeTempDir({
    dir: "/tmp/opencode",
    prefix: "hj-native-summary-",
  });
  const root = pathToFileURL(`${directory}/`);
  try {
    await writeTextFile(
      new URL("deno.json", root),
      JSON.stringify({
        tasks: {
          format: "deno run other.ts",
          coverage: "deno run other.ts",
          "ci-deno": { dependencies: ["format", "coverage"] },
          "native-tests": {
            command: "deno run --allow-env=NO_COLOR emit.ts",
            dependencies: ["coverage"],
          },
          ci: { dependencies: ["ci-deno", "native-tests"] },
          all: { dependencies: ["ci"] },
        },
      }),
    );
    await writeTextFile(
      new URL("other.ts", root),
      'await new Promise(resolve => setTimeout(resolve, 20));\nconsole.log("dummy-task");\n',
    );
    const environments: Record<string, string>[] = [{}, { FORCE_COLOR: "1" }, {
      NO_COLOR: "",
      FORCE_COLOR: "1",
    }, { NO_COLOR: "1" }];
    for (const env of environments) {
      await writeTextFile(
        new URL("emit.ts", root),
        `if (Deno.env.has("NO_COLOR") !== ${
          Object.hasOwn(env, "NO_COLOR")
        }) throw new Error("incorrect fixture environment");\n` +
          `console.log(${
            JSON.stringify("private-stdout\n" + line(nativeSummaryFixture()))
          });\n` +
          'console.error("private-stderr");\n',
      );
      const result = await captureSummaryTask(root, {
        PATH: `${dirname(externalDeno)}${delimiter}/usr/bin:/bin`,
        HOME: directory,
        ...env,
        CI: "true",
        GITHUB_ACTIONS: "true",
      });
      assertEquals(
        result.success,
        true,
        new TextDecoder().decode(result.stderr),
      );
      const stdout = new TextDecoder().decode(result.stdout);
      assertEquals(
        stdout.includes("\x1b["),
        env.NO_COLOR !== "1",
      );
      assertEquals(stdout.includes("[native-tests]"), true);
      assertEquals(
        nativeValidationSummary(stdout),
        line(nativeSummaryFixture()),
      );
      assertEquals(
        nativeValidationSummary(new TextDecoder().decode(result.stderr)),
        "",
      );
    }
  } finally {
    await remove(directory, { recursive: true });
  }
});

test("release summary prefixes accept color codes but reject other terminal controls", () => {
  const record = line(nativeSummaryFixture());
  assertEquals(
    nativeValidationSummary(`\x1b[0m\x1b[33m [native-tests]\x1b[0m ${record}`),
    record,
  );
  assertEquals(
    nativeValidationSummary(`\x1b[38;5;12m [native-tests]\x1b[0m ${record}`),
    record,
  );
  for (
    const control of ["\x1b[2J", "\x1b[1A", "\x1b]0;private\x07"]
  ) {
    assertEquals(
      nativeValidationSummary(`${control}[native-tests] ${record}`),
      "",
    );
    assertEquals(
      nativeValidationSummary(`[native-tests] ${control}${record}`),
      "",
    );
  }
  assertEquals(
    nativeValidationSummary(record.replace("summary: ", "summary: \x1b[0m")),
    "",
  );
  assertEquals(nativeValidationSummary(record.trimEnd() + "\x1b[0m\n"), "");
  assertEquals(
    nativeValidationSummary(
      line({ ...nativeSummaryFixture(), context: "\x1b[0m" + "a".repeat(64) }),
    ),
    "",
  );
});

test("release summaries contain only fixed fields from native observations", () => {
  const expected = ["node24", "node26", "bun"].map(nativeSummaryFixture);
  const captured = expected.map((value) => ({
    ...value,
    environment: "private-environment",
    groups: {
      ...value.groups,
      "private-group": "private-data",
      "release-core": {
        ...value.groups["release-core"],
        extra: "private-group-data",
        inputs: {
          ...value.groups["release-core"].inputs,
          extra: "private-input",
        },
      },
    },
  }));
  assertEquals(
    nativeValidationSummary(
      "private-output\n" +
        captured.map((value) => ` [native-tests] ${line(value)}`).join("") +
        "::warning::private-workflow-command\n",
    ),
    expected.map(line).join(""),
  );
});

test("release summaries ignore malformed observations without command output", () => {
  type Fixture = ReturnType<typeof nativeSummaryFixture>;
  const changes: ((value: Fixture) => unknown)[] = [
    () => null,
    () => [],
    (value) => ({ ...value, runtime: "private-runtime" }),
    (value) => ({ ...value, cacheEligible: true }),
    (value) => ({ ...value, context: "A".repeat(64) }),
    (value) => ({ ...value, context: "a".repeat(63) }),
    (value) => ({ ...value, context: "a".repeat(64) + "\n" }),
    (value) => ({ ...value, context: "::warning::private" }),
    (value) => ({ ...value, buildMs: -1 }),
    (value) => ({ ...value, buildObservationMs: "private-duration" }),
    (value) => ({ ...value, observationMs: null }),
    (value) => ({ ...value, groups: null }),
    (value) => ({ ...value, groups: [] }),
    (value) => ({
      ...value,
      groups: { "release-core": value.groups["release-core"] },
    }),
    (value) => {
      value.groups["release-core"].key = "invalid";
      return value;
    },
    (value) => {
      delete value.groups["github-repository"].inputs.tools;
      return value;
    },
    (value) => {
      value.groups["github-repository"].inputs.packages = "c".repeat(65);
      return value;
    },
  ];
  for (const change of changes) {
    assertEquals(
      nativeValidationSummary(line(change(nativeSummaryFixture()))),
      "",
    );
  }
  assertEquals(nativeValidationSummary("Native input summary: not-json\n"), "");
  assertEquals(
    nativeValidationSummary(
      line(nativeSummaryFixture()).replace(
        '"buildMs":123.5',
        '"buildMs":1e999',
      ),
    ),
    "",
  );
});

test("release summaries bound records and reject duplicate runtimes", () => {
  const first = nativeSummaryFixture();
  const second = nativeSummaryFixture("bun");
  assertEquals(
    nativeValidationSummary(line({ ...first, extra: "x".repeat(4096) })),
    "",
  );
  assertEquals(
    nativeValidationSummary(
      line(first) + line(second) + line(first) + line(first),
    ),
    line(second),
  );
  assertEquals(nativeValidationSummary(`private-prefix ${line(first)}`), "");
  assertEquals(nativeValidationSummary("private-output"), "");
});
