import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  colorText,
  formatCliError,
  terminalColor,
  useColor,
} from "./terminal-colors.ts";
import { formatTable } from "./format-table.ts";

Deno.test("color policy follows Deno overrides and each output stream", () => {
  for (const terminal of [false, true]) {
    for (const noColor of [false, true]) {
      for (const term of [undefined, "xterm-256color", "dumb"]) {
        for (const forceColor of [undefined, "", "1", "0"]) {
          assertEquals(
            useColor(terminal, { noColor, term, forceColor }),
            Boolean(forceColor) || (terminal && !noColor && term !== "dumb"),
          );
        }
      }
    }
  }
  // The test runner grants no TERM permission. Detection must not prompt.
  assertEquals(
    terminalColor({ isTerminal: () => false }),
    Boolean(Deno.env.get("FORCE_COLOR")),
  );
});

Deno.test("colored tables preserve plain alignment, wrapping, and status words", () => {
  const rows = [
    ["git", "enabled", "one two three\nfour"],
    ["fmt", "drifted", "custom task"],
    ["jsr", "ambiguous"],
    ["readme", "disabled"],
    ["other", "unknown"],
  ];
  const headers = ["Feature", "State", "Details"];
  const limits = [10, 12, 8];
  const plain = formatTable(headers, rows, limits);
  const colored = formatTable(headers, rows, limits, {
    color: true,
    columns: ["cyan", "state"],
  });
  // deno-lint-ignore no-control-regex -- Compare visible text after ANSI removal.
  assertEquals(colored.replaceAll(/\u001b\[\d+m/g, ""), plain);
  assertStringIncludes(colored, "\x1b[1mFeature\x1b[0m");
  assertStringIncludes(colored, "\x1b[36mgit\x1b[0m");
  for (
    const [state, code] of [
      ["enabled", 32],
      ["drifted", 33],
      ["ambiguous", 31],
      ["disabled", 2],
      ["unknown", 2],
    ]
  ) {
    assertStringIncludes(colored, `\x1b[${code}m${state}\x1b[0m`);
  }
  assertEquals(
    formatTable(headers, rows, limits, {
      color: false,
      columns: ["cyan", "state"],
    }),
    plain,
  );
});

Deno.test("styles reset at line ends and errors keep details readable", () => {
  assertEquals(
    colorText("ok\n\nnext\r\n", "green", true),
    "\x1b[32mok\x1b[0m\n\n\x1b[32mnext\x1b[0m\r\n",
  );
  assertEquals(colorText("", "bold", true), "");
  assertEquals(colorText("plain", undefined, true), "plain");
  assertEquals(
    formatCliError(new Error("blocked:\nDetails"), true),
    "\x1b[31mblocked:\x1b[0m\nDetails",
  );
  assertEquals(formatCliError("failure"), "failure");
});

Deno.test("executable honors color overrides in pipes without permission prompts", async () => {
  const cli = new URL("./cli.ts", import.meta.url).href;
  for (
    const [env, colored] of [
      [{ NO_COLOR: "", FORCE_COLOR: "", TERM: "xterm" }, false],
      [{ NO_COLOR: "1", FORCE_COLOR: "", TERM: "xterm" }, false],
      [{ NO_COLOR: "", FORCE_COLOR: "", TERM: "dumb" }, false],
      [{ NO_COLOR: "", FORCE_COLOR: "1", TERM: "dumb" }, true],
      [{ NO_COLOR: "1", FORCE_COLOR: "1", TERM: "xterm" }, true],
    ] as const
  ) {
    for (
      const args of [["--help"], ["repo", "features", "--help"], ["unknown"]]
    ) {
      const result = await new Deno.Command("deno", {
        args: ["run", "--frozen", "--no-prompt", cli, ...args],
        env,
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
      }).output();
      const error = args[0] === "unknown";
      assertEquals(result.code, error ? 1 : 0);
      const text = new TextDecoder().decode(
        error ? result.stderr : result.stdout,
      );
      assertEquals(text.includes("\x1b["), colored);
      assertStringIncludes(
        text,
        error ? "Unknown command" : "--help" === args[0] ? "Command" : "Flag",
      );
      assertEquals((error ? result.stdout : result.stderr).length, 0);
    }
  }
});
