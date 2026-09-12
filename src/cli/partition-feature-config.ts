/** Attribute precomposed Deno configuration to its contributing features. */
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";
import type { ChangePlan } from "../api/change-plan.ts";
import type { JsonValue } from "../api/json.ts";
import { sameJson } from "../operations/local-plan-state.ts";
import { denoCliInitialConfigContribution } from "../features/deno-cli-artifacts.ts";
import { denoLibInitialConfigContribution } from "../features/deno-lib-artifacts.ts";
import { denoServerInitialConfigContribution } from "../features/deno-server-artifacts.ts";
import {
  denoTaskDefinitions,
  leafTaskDefinitions,
  leafTaskNames,
  taskFeatureIds,
} from "../features/deno-tasks.ts";
import {
  publishCheckDefinition,
  publishCheckName,
} from "../features/jsr-package-config.ts";

interface FileVersion {
  readonly bytes: Uint8Array;
  readonly mode: string;
}
type FileSnapshot = Map<string, FileVersion>;
interface FeatureFiles {
  readonly plan: ChangePlan;
  readonly files: Map<string, FileVersion | undefined>;
}
interface Contribution {
  readonly featureId: string;
  readonly path: string[];
  readonly value: unknown;
}

/** Adjust commit snapshots only; the validated working files stay untouched. */
export function partitionFeatureConfig(
  plans: readonly ChangePlan[],
  baseline: FileSnapshot,
  features: FeatureFiles[],
  _final: FileSnapshot,
): void {
  for (const path of ["deno.json", "deno.jsonc"]) {
    const before = baseline.get(path);
    const initial = before ? object(before) : {};
    if (!initial) continue;
    const writer = plans.find((plan) =>
      plan.changes.some((change) =>
        "path" in change && change.path === path &&
        ((!before && change.kind === "write-file") ||
          (initial.tasks === undefined && change.kind === "set-json" &&
            sameJson(change.jsonPath, ["tasks"])))
      )
    );
    if (!writer) continue;
    const seed = features.find((item) =>
      item.plan.featureId === writer.featureId
    )
      ?.files.get(path);
    const seedValue = seed && object(seed);
    if (!seedValue) continue;
    const contributions = configContributions(seedValue).filter((item) =>
      (!before || item.path[0] === "tasks") &&
      at(initial, item.path) === undefined &&
      sameJson(
        at(seedValue, item.path) as JsonValue | undefined,
        item.value as JsonValue | undefined,
      ) &&
      plans.some((plan) =>
        plan.featureId === item.featureId && plan.action === "enable"
      )
    );
    if (!contributions.length) continue;
    for (const contribution of contributions) {
      if (
        features.some((item) => item.plan.featureId === contribution.featureId)
      ) {
        continue;
      }
      features.push({
        plan: plans.find((plan) => plan.featureId === contribution.featureId)!,
        files: new Map(),
      });
    }
    features.sort((left, right) =>
      plans.indexOf(left.plan) - plans.indexOf(right.plan)
    );
    let actual = before;
    let previous = before;
    const reached = new Set<string>();
    for (const feature of features) {
      reached.add(feature.plan.featureId);
      if (feature.files.has(path)) actual = feature.files.get(path);
      if (!actual) {
        if (previous) feature.files.set(path, undefined);
        previous = undefined;
        continue;
      }
      let text = new TextDecoder().decode(actual.bytes);
      const pending = contributions.filter((item) =>
        !reached.has(item.featureId)
      );
      for (const item of pending) text = edit(text, item.path, undefined);
      for (const group of ["exports", "tasks", "imports"]) {
        const value = parse(text);
        if (
          initial[group] === undefined && record(value[group]) &&
          Object.keys(value[group]).length === 0
        ) text = edit(text, [group], undefined);
      }
      const value = parse(text);
      const check = value.tasks?.check;
      if (record(check) && Array.isArray(check.dependencies)) {
        const futureTasks = new Set(
          pending.filter((item) => item.path[0] === "tasks")
            .map((item) => item.path[1]),
        );
        const dependencies = check.dependencies.filter((name: unknown) =>
          typeof name !== "string" || !futureTasks.has(name)
        );
        if (!sameJson(dependencies, check.dependencies)) {
          text = edit(text, ["tasks", "check", "dependencies"], dependencies);
        }
      }
      if (
        pending.some((item) => item.featureId === "readme-build") &&
        sameJson(value.tasks?.default, denoTaskDefinitions([], true).default)
      ) {
        text = edit(text, ["tasks", "default"], denoTaskDefinitions().default);
      }
      const next = { ...actual, bytes: new TextEncoder().encode(text) };
      if (equal(previous, next)) feature.files.delete(path);
      else feature.files.set(path, next);
      previous = next;
    }
  }
}

function configContributions(config: Record<string, unknown>): Contribution[] {
  const result: Contribution[] = [];
  for (
    const declaration of [
      denoCliInitialConfigContribution,
      denoLibInitialConfigContribution,
      denoServerInitialConfigContribution,
    ]
  ) {
    for (const [group, entries] of Object.entries(declaration.value)) {
      for (const [key, value] of Object.entries(entries)) {
        result.push({
          featureId: declaration.featureId,
          path: [group, key],
          value,
        });
      }
    }
  }
  for (const featureId of taskFeatureIds) {
    result.push({
      featureId,
      path: ["tasks", leafTaskNames[featureId]],
      value: leafTaskDefinitions[featureId],
    });
  }
  const tasks = record(config.tasks) ? config.tasks : {};
  for (const key of ["coverage", "dev", "dev:test"]) {
    const task = tasks[key];
    if (
      record(task) &&
      (task.command === "deno task test" ||
        task.command === "deno test --parallel --trace-leaks --watch")
    ) {
      result.push({
        featureId: "deno-test",
        path: ["tasks", key],
        value: task,
      });
    }
  }
  result.push({
    featureId: "readme-build",
    path: ["tasks", "readme"],
    value: denoTaskDefinitions([], true).readme,
  }, {
    featureId: "jsr-package",
    path: ["tasks", publishCheckName],
    value: publishCheckDefinition,
  });
  for (const key of ["name", "version"]) {
    if (config[key] !== undefined) {
      result.push({
        featureId: "jsr-package",
        path: [key],
        value: config[key],
      });
    }
  }
  return result;
}

function edit(text: string, path: string[], value: unknown): string {
  return applyEdits(
    text,
    modify(text, path, value, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    }),
  );
}

function at(value: unknown, path: string[]): unknown {
  for (const key of path) value = record(value) ? value[key] : undefined;
  return value;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function object(file: FileVersion): Record<string, unknown> | undefined {
  const errors: ParseError[] = [];
  const value: unknown = parse(new TextDecoder().decode(file.bytes), errors);
  return errors.length === 0 && record(value) ? value : undefined;
}

function equal(left: FileVersion | undefined, right: FileVersion): boolean {
  return left !== undefined && left.mode === right.mode &&
    left.bytes.length === right.bytes.length &&
    left.bytes.every((byte, index) => byte === right.bytes[index]);
}
