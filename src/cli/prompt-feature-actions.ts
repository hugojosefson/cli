/** @module Terminal adapter for interactive feature selection. */
import type { FeatureAction } from "./feature-actions.ts";
import { PromptCancelled } from "./prompt-cancelled.ts";
import {
  type PromptTerminal,
  selectTerminalActions,
} from "./terminal-prompt.ts";

/** Prompts for feature actions, failing plainly when stdin is not a TTY. */
export async function promptFeatureActions(
  actions: readonly FeatureAction[],
  terminal?: PromptTerminal,
): Promise<readonly string[]> {
  const selected = await selectTerminalActions(actions, terminal);
  if (selected === null) throw new PromptCancelled();
  return selected;
}
