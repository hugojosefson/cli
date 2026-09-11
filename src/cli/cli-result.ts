/** Text returned by commands before the terminal adapter writes it. */
export interface CliResult {
  readonly output: string;
  readonly terminalNewline: boolean;
}
