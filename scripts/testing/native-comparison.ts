import type { NativeObservation } from "./native-types.ts";

export function compareNativeObservation(
  before: NativeObservation | undefined,
  after: NativeObservation | undefined,
  name: string,
): string {
  if (!before || !after) {
    return " Native observation is unavailable.";
  }
  for (const value of [before, after]) {
    if (
      value.schema !== 1 || value.mode !== "observation-only" ||
      value.cacheEligible !== false ||
      !value.snapshot.groups[name]?.key
    ) {
      throw new Error("Native observation is not compatible");
    }
  }
  const old = before.snapshot.groups[name];
  const current = after.snapshot.groups[name];
  const changed = [
    ...new Set([...Object.keys(old.inputs), ...Object.keys(current.inputs)]),
  ]
    .filter((path) => old.inputs[path] !== current.inputs[path]).sort();
  return ` Native proposed inputs ${
    old.key === current.key ? "agree" : "changed"
  }.` +
    (changed.length ? ` Native changed inputs: ${changed.join(", ")}.` : "") +
    " Cache restoration is disabled.";
}
