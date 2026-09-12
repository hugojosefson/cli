import { compareNativeObservation } from "./native-comparison.ts";
import type { NativeObservation } from "./native-types.ts";
/** Proposed reuse only: these observations never authorize skipping validation. */
import { createHash } from "node:crypto";
import type { InventoryEvent, InventoryReport } from "./manifest.ts";

export const observationSchema = 2;
const githubTests = [
  "src/repository/github-default-project_test.ts",
  "src/repository/github-project-area_test.ts",
  "src/repository/github-repository-setup_test.ts",
  "src/repository/local-github-client_test.ts",
  "src/repository/local-github-identity-reader_test.ts",
];
export const focusedGroups = [
  { name: "github-repository", files: githubTests },
  {
    name: "release-core",
    files: [
      "src/release/publish-tag-orchestration_test.ts",
      "src/release/publish-tag-prepare_test.ts",
    ],
  },
];
export const focusedTests = focusedGroups.flatMap((group) => group.files);

export function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export interface GroupInputs {
  inputs: Record<string, string>;
  key: string;
  boundary: "isolated" | "conservative";
  reasons: string[];
}
export interface InputSnapshot {
  schema: number;
  context: string;
  files: string[];
  groups: Record<string, GroupInputs>;
  broadInputs: Record<string, string>;
  broadKey: string;
}

export interface GroupObservation {
  name: string;
  files: string[];
  bodies: number;
  bodyMs: number;
  candidateKey: string;
  executionKey: string;
}

export interface ValidationObservation {
  schema: number;
  mode: "observation-only";
  inputs: InputSnapshot;
  stableInputs: boolean;
  suiteWallMs: number;
  groups: GroupObservation[];
}

/** Sum top-level bodies only: parent timings already include nested subtests. */
export function bodyTimings(events: InventoryEvent[]): Map<string, number> {
  const starts = new Map<string, number>();
  const totals = new Map<string, number>();
  for (const event of events) {
    if (event.topLevel === undefined) {
      throw new Error(`Missing timing nesting: ${event.id}`);
    }
    if (!event.topLevel) continue;
    if (!Number.isFinite(event.timeMs)) {
      throw new Error(`Missing body timing: ${event.id}`);
    }
    if (event.state === "started") starts.set(event.id, event.timeMs!);
    if (event.state === "passed") {
      const start = starts.get(event.id);
      if (start === undefined || event.timeMs! < start) {
        throw new Error(`Invalid body timing: ${event.id}`);
      }
      const file = event.id.split(" > ")[0];
      totals.set(file, (totals.get(file) ?? 0) + event.timeMs! - start);
      starts.delete(event.id);
    }
  }
  return totals;
}

export function observeValidation(
  report: InventoryReport,
  events: InventoryEvent[],
  before: InputSnapshot,
  after: InputSnapshot,
  suiteWallMs: number,
): ValidationObservation {
  if (!report.complete || !report.success) {
    throw new Error("Observation requires a fresh complete successful suite");
  }
  if (JSON.stringify(report.files) !== JSON.stringify(before.files)) {
    throw new Error("Observation source inventory differs from the suite");
  }
  const times = bodyTimings(events);
  const groups = [
    ...focusedGroups,
    {
      name: "remainder",
      files: report.files.filter((file) => !focusedTests.includes(file)),
    },
  ].map(({ name, files }) => {
    if (files.some((file) => !times.has(file))) {
      throw new Error(`Missing group timing: ${name}`);
    }
    const candidateKey = before.groups[name]?.key ?? before.broadKey;
    return {
      name,
      files: [...files],
      bodies: report.tests.filter((test) =>
        files.includes(test.split(" > ")[0])
      ).length,
      bodyMs: files.reduce((total, file) => total + times.get(file)!, 0),
      candidateKey,
      // Native emission still includes every test and the actual CLI metadata.
      executionKey: report.runtime === "deno" ? candidateKey : before.broadKey,
    };
  });
  return {
    schema: observationSchema,
    mode: "observation-only",
    inputs: before,
    stableInputs: before.broadKey === after.broadKey &&
      focusedGroups.every(({ name }) =>
        before.groups[name].key === after.groups[name].key
      ),
    suiteWallMs,
    groups,
  };
}

export type ObservedReport = InventoryReport & {
  version: string;
  observation?: ValidationObservation;
  nativeObservation?: NativeObservation;
};

function requireObservation(report: ObservedReport): ValidationObservation {
  const observation = report.observation;
  if (observation && observation.schema !== observationSchema) {
    throw new Error(
      `Incompatible observation schema: expected ${observationSchema}, received ${observation.schema}. Collect fresh reports.`,
    );
  }
  if (
    report.complete !== true || report.success !== true ||
    !observation || observation.schema !== observationSchema ||
    observation.mode !== "observation-only" || !observation.stableInputs
  ) throw new Error("Need complete successful observations with stable inputs");
  const files = observation.groups.flatMap((group) => group.files).sort();
  if (
    new Set(files).size !== files.length ||
    JSON.stringify(files) !== JSON.stringify(report.files) ||
    observation.groups.map((group) => group.name).join() !==
      [...focusedGroups.map((group) => group.name), "remainder"].join()
  ) {
    throw new Error(
      "Observation groups do not partition the complete inventory",
    );
  }
  return observation;
}

export function compareObservations(
  previous: ObservedReport,
  current: ObservedReport,
): string[] {
  const before = requireObservation(previous);
  const after = requireObservation(current);
  if (previous.runtime !== current.runtime) {
    throw new Error("Compare the same runtime in both reports");
  }
  return after.groups.map((group, index) => {
    const old = before.groups[index];
    const match = old.candidateKey === group.candidateKey;
    const executable = old.executionKey === group.executionKey;
    const previousInputs = before.inputs.groups[group.name]?.inputs ??
      before.inputs.broadInputs;
    const currentInputs = after.inputs.groups[group.name]?.inputs ??
      after.inputs.broadInputs;
    const changed = [
      ...new Set([
        ...Object.keys(previousInputs),
        ...Object.keys(currentInputs),
      ]),
    ].filter((file) => previousInputs[file] !== currentInputs[file]).sort();
    return `${group.name}: candidate inputs ${match ? "match" : "changed"}; ` +
      `current execution inputs ${executable ? "match" : "changed"}; ` +
      `${old.bodyMs.toFixed(1)} ms previous top-level bodies, ` +
      `${group.bodyMs.toFixed(1)} ms current (${group.bodies} bodies).` +
      (changed.length ? ` Changed inputs: ${changed.join(", ")}.` : "") +
      (before.inputs.context !== after.inputs.context
        ? " Runtime, platform, or environment context changed."
        : "") +
      (current.runtime !== "deno" && group.name !== "remainder"
        ? compareNativeObservation(
          previous.nativeObservation,
          current.nativeObservation,
          group.name,
        )
        : "");
  });
}
