/** Color policy and a small palette for human-facing CLI output. */
import process from "node:process";
export interface OutputColors {
  readonly stdout?: boolean;
  readonly stderr?: boolean;
}

export interface ColorEnvironment {
  readonly noColor: boolean;
  readonly forceColor?: string;
  readonly term?: string;
}

/** Follow Deno: any nonempty FORCE_COLOR value overrides other settings. */
export function useColor(
  terminal: boolean,
  environment: ColorEnvironment,
): boolean {
  if (environment.forceColor) return true;
  return !environment.noColor && environment.term !== "dumb" && terminal;
}

/** Read optional terminal settings without prompting for permissions. */
export function terminalColor(
  stream: { isTerminal?(): boolean; readonly isTTY?: boolean },
): boolean {
  const deno = (globalThis as {
    Deno?: {
      permissions: {
        querySync(
          descriptor: { name: "env"; variable: string },
        ): { state: string };
      };
    };
  }).Deno;
  const allowed = !deno ||
    deno.permissions.querySync({ name: "env", variable: "TERM" }).state ===
      "granted";
  return useColor(stream.isTerminal?.() ?? stream.isTTY === true, {
    noColor: Boolean(process.env.NO_COLOR),
    forceColor: process.env.FORCE_COLOR,
    term: allowed ? process.env.TERM : "dumb",
  });
}

const styles = { bold: 1, dim: 2, red: 31, green: 32, yellow: 33, cyan: 36 };
export type ColorStyle = keyof typeof styles;

/** Apply basic ANSI styles, with no dependence on global color state. */
export function colorText(
  text: string,
  style: ColorStyle | undefined,
  enabled = false,
): string {
  return enabled && style && text
    ? text.replace(
      /[^\r\n]+/g,
      (line) => `\x1b[${styles[style]}m${line}\x1b[0m`,
    )
    : text;
}

export function stateColor(state: string): ColorStyle {
  switch (state) {
    case "enabled":
      return "green";
    case "drifted":
      return "yellow";
    case "ambiguous":
      return "red";
    default:
      return "dim";
  }
}

/** Highlight the error's first line without tinting its whole details table. */
export function formatCliError(error: unknown, color = false): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^[^\n]*/, (line) => colorText(line, "red", color));
}
