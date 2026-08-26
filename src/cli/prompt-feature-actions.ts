/** @module Terminal adapter for interactive feature selection. */

import { promptMultipleSelect } from "@std/cli/unstable-prompt-multiple-select";
import type { FeatureAction } from "./feature-actions.ts";

/** Prompts for feature actions, failing plainly when stdin is not a TTY. */
export function promptFeatureActions(
  actions: readonly FeatureAction[],
): readonly string[] {
  const selected = promptMultipleSelect<string>(
    "Select feature actions:",
    actions.map(({ label, value }) => ({ label, value })),
  );
  if (selected === null) throw new Error("interactive mode requires a TTY");
  return selected.map(({ value }) => value);
}
