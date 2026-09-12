import type { InventoryReport } from "./manifest.ts";
import type { NativeObservation, NativeSnapshot } from "./native-types.ts";
import { digest } from "./observation.ts";

export function nativeResult(
  report: InventoryReport,
  before: NativeSnapshot,
  after: NativeSnapshot,
  observationMs: number,
): NativeObservation {
  if (
    !report.complete || !report.success || report.runtime === "deno" ||
    digest(report.files) !== digest(before.inventory) ||
    digest(before) !== digest(after)
  ) {
    throw new Error("Native observation needs complete stable test execution");
  }
  return {
    schema: 1,
    mode: "observation-only",
    cacheEligible: false,
    snapshot: before,
    observationMs,
    limits: [
      "runtime-file-reads-need-audit",
      "host-libraries-not-hashed",
      "absolute-tool-paths-affect-keys",
      "npm-launcher-libraries-not-hashed",
      "external-code-not-audited",
      "no-cache-restoration",
    ],
  };
}
