/** @module Loads the portable prompt library only for interactive input. */
import { stdin, stdout } from "node:process";
import type { Readable, Writable } from "node:stream";
import type { FeatureAction } from "./feature-actions.ts";

export interface PromptTerminal {
  readonly input: Readable & { readonly isTTY?: boolean };
  readonly output: Writable;
}
const defaultTerminal: PromptTerminal = { input: stdin, output: stdout };

/** Selects action values, preserving selection order across filter changes. */
export async function selectTerminalActions(
  actions: readonly FeatureAction[],
  terminal: PromptTerminal = defaultTerminal,
): Promise<readonly string[] | null> {
  if (!terminal.input.isTTY) throw new Error("interactive mode requires a TTY");
  const view = await import("./terminal-prompt-view.ts");
  return await view.selectTerminalActions(actions, terminal);
}

/** Reads explicit text; non-terminal input and cancellation yield null. */
export async function promptTerminalText(
  message: string,
  terminal: PromptTerminal = defaultTerminal,
): Promise<string | null> {
  if (!terminal.input.isTTY) return null;
  const view = await import("./terminal-prompt-view.ts");
  return await view.promptTerminalText(message, terminal);
}
