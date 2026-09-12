/** @module Portable terminal prompts using Inquirer's public prompt hooks. */
import {
  createPrompt,
  ExitPromptError,
  useEffect,
  useKeypress,
  useState,
} from "@inquirer/core";
import { stdout } from "node:process";
import type { FeatureAction } from "./feature-actions.ts";
import type { PromptTerminal } from "./terminal-prompt.ts";

/** Resolves terminal EOF before the runtime exits with an unfinished prompt. */
function useEndOfInput(done: () => void): void {
  useEffect((terminal) => {
    terminal.on("close", done);
    return () => terminal.removeListener("close", done);
  }, []);
}

const select = createPrompt<readonly string[] | null, {
  readonly actions: readonly FeatureAction[];
}>(({ actions }, done) => {
  const [filter, setFilter] = useState("");
  const [active, setActive] = useState(0);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const visible = actions.filter(({ label }) =>
    label.toLowerCase().includes(filter.toLowerCase())
  );
  useEndOfInput(() => done(null));
  useKeypress((key, terminal) => {
    if (key.name === "escape" || (key.ctrl && key.name === "d")) {
      done(null);
    } else if (key.name === "enter" || key.name === "return") {
      done(selected);
    } else if (key.name === "up" || key.name === "down") {
      setActive(
        visible.length
          ? (active + (key.name === "up" ? -1 : 1) + visible.length) %
            visible.length
          : 0,
      );
    } else if (key.name === "space") {
      const value = visible[active]?.value;
      if (value !== undefined) {
        setSelected(
          selected.includes(value)
            ? selected.filter((entry) => entry !== value)
            : [...selected, value],
        );
      }
    } else if (key.name === "backspace") {
      setFilter(filter.slice(0, -1));
      setActive(0);
    } else if (
      !key.ctrl && terminal.line
    ) {
      setFilter(filter + terminal.line);
      setActive(0);
    }
    terminal.clearLine(0);
  });
  const pageSize = Math.max(1, (stdout.rows || 24) - 5);
  const start = Math.max(0, active - pageSize + 1);
  const choices = visible.slice(start, start + pageSize).map((
    { label, value },
    index,
  ) =>
    `${index + start === active ? "❯" : " "} ${
      selected.includes(value) ? "◉" : "◯"
    } ${label}`
  );
  return [
    `Select feature actions: ${filter}`,
    "Type to filter; ↑/↓ to move; space to toggle; enter to confirm; Ctrl+C to cancel.",
    ...(choices.length ? choices : ["No matching actions."]),
  ].join("\n");
});

const text = createPrompt<string | null, { readonly message: string }>(
  ({ message }, done) => {
    const [value, setValue] = useState("");
    useEndOfInput(() => done(null));
    useKeypress((key, terminal) => {
      if (key.name === "escape" || (key.ctrl && key.name === "d")) done(null);
      else if (key.name === "enter" || key.name === "return") {
        done(value);
      } else if (key.name === "backspace") {
        setValue([...value].slice(0, -1).join(""));
      } else if (!key.ctrl && terminal.line) {
        setValue(value + terminal.line);
      }
      terminal.clearLine(0);
    });
    return `${message}: ${value}`;
  },
);

/** Selects action values, preserving selection order across filter changes. */
export async function selectTerminalActions(
  actions: readonly FeatureAction[],
  terminal: PromptTerminal,
): Promise<readonly string[] | null> {
  try {
    return await select({ actions }, terminal);
  } catch (error) {
    if (error instanceof ExitPromptError) return null;
    throw error;
  }
}

/** Reads an explicit text answer; non-terminal input and cancellation yield null. */
export async function promptTerminalText(
  message: string,
  terminal: PromptTerminal,
): Promise<string | null> {
  try {
    return await text({ message }, terminal);
  } catch (error) {
    if (error instanceof ExitPromptError) return null;
    throw error;
  }
}
