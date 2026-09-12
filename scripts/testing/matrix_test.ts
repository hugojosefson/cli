import { test as nativeTest } from "node:test";
import { trackTests } from "../../src/testing/inventory-test-fixtures.ts";
import { assertThrows } from "@std/assert";
import { matrixRuntimes, validateMatrixReports } from "./matrix.ts";
const test = trackTests(import.meta.url, nativeTest);

test("cross-job matrix rejects wrong versions, duplicate runtimes and incomplete current inventory", () => {
  const files = ["src/a_test.ts", "src/b_test.ts"];
  const tests = files.map((file) => `${file} > body`);
  const reports = [
    {
      runtime: "deno",
      version: "deno 2.9.6 (stable, release, x86_64-unknown-linux-gnu)",
    },
    ...Object.values(matrixRuntimes),
  ].map((runtime) => ({
    ...runtime,
    complete: true,
    success: true,
    files,
    tests,
  }));
  validateMatrixReports(reports, files, "2.9.6");
  assertThrows(() => validateMatrixReports(reports.slice(1), files, "2.9.6"));
  assertThrows(() =>
    validateMatrixReports(reports, [...files, "src/new_test.ts"], "2.9.6")
  );
  assertThrows(() => validateMatrixReports(reports, files, "2.9.7"));
  assertThrows(() =>
    validateMatrixReports(
      [reports[0], reports[1], reports[1], reports[3]],
      files,
      "2.9.6",
    )
  );
  for (
    const change of [
      { complete: false },
      { success: false },
      { tests: [] },
      { files: [] },
      { version: "v24.0.0" },
      { runtime: "bun" },
    ]
  ) {
    assertThrows(() =>
      validateMatrixReports(
        reports.map((report, index) =>
          index === 1 ? { ...report, ...change } : report
        ),
        files,
        "2.9.6",
      )
    );
  }
  for (
    const changedTests of [
      [tests[0]],
      [...tests, tests[0]],
      [...tests, "src/extra_test.ts > body"],
    ]
  ) {
    assertThrows(() =>
      validateMatrixReports(
        reports.map((report) => ({ ...report, tests: changedTests })),
        files,
        "2.9.6",
      )
    );
  }
});
