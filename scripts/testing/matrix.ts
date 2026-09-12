/** Shared native runtime pins and the fail-closed cross-job report gate. */
import { compareInventories, type InventoryReport } from "./manifest.ts";

export const matrixRuntimes = {
  node24: { runtime: "node", path: "node24/bin/node", version: "v24.21.0" },
  node26: { runtime: "node", path: "node26/bin/node", version: "v26.2.0" },
  bun: {
    runtime: "bun",
    path: "@oven/bun-linux-x64/bin/bun",
    version: "1.4.2",
  },
};

/** Reports come from this run's isolated jobs, in Deno/Node24/Node26/Bun order. */
export function validateMatrixReports(
  reports: (InventoryReport & { version: string })[],
  files: string[],
  denoVersion: string,
): void {
  compareInventories(reports);
  const expected = [
    { runtime: "deno", version: `deno ${denoVersion}` },
    ...Object.values(matrixRuntimes),
  ];
  for (const [index, report] of reports.entries()) {
    const runtime = expected[index];
    const version = index === 0
      ? report.version.split(" ").slice(0, 2).join(" ")
      : report.version.trim();
    if (report.runtime !== runtime.runtime || version !== runtime.version) {
      throw new Error(
        `Unexpected runtime report: expected ${runtime.runtime} ${runtime.version}`,
      );
    }
    if (
      report.complete !== true || report.success !== true ||
      JSON.stringify(report.files) !== JSON.stringify(files)
    ) {
      throw new Error(
        `Report does not cover the current complete source inventory: ${runtime.runtime}`,
      );
    }
    if (
      new Set(report.tests).size !== report.tests.length ||
      report.tests.some((test) =>
        !files.some((file) => test.startsWith(file + " > "))
      ) ||
      files.some((file) =>
        !report.tests.some((test) => test.startsWith(file + " > "))
      )
    ) {
      throw new Error(
        `Missing, duplicate or unexpected test bodies: ${runtime.runtime}`,
      );
    }
  }
}
