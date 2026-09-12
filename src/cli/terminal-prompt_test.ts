import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { promptFeatureActions } from "./prompt-feature-actions.ts";
import { PromptCancelled } from "./prompt-cancelled.ts";
import { PassThrough } from "node:stream";
import {
  promptTerminalText,
  selectTerminalActions,
} from "./terminal-prompt.ts";

const actions = [
  { label: "enable git", value: "enable:git" },
  { label: "repair docs", value: "repair:docs" },
  { label: "disable yaml", value: "disable:yaml" },
];

function terminal() {
  const input = Object.assign(new PassThrough(), {
    isTTY: true,
    isRaw: false,
    setRawMode(value: boolean) {
      this.isRaw = value;
      return this;
    },
  });
  const output = new PassThrough();
  let rendered = "";
  const ready = new Promise<void>((resolve) => {
    output.on("data", (chunk) => {
      rendered += chunk.toString();
      if (/Select feature actions:|Scope:|Visibility:/.test(rendered)) {
        resolve();
      }
    });
  });
  return {
    input,
    output,
    ready,
    text: () => rendered,
    close: () => {
      input.destroy();
      output.destroy();
    },
  };
}

Deno.test("portable action prompt filters and keeps selection order across filters", async () => {
  const io = terminal();
  try {
    const selected = promptFeatureActions(actions, io);
    await io.ready;
    for (
      const key of [
        "docs",
        " ",
        "\x7f",
        "\x7f",
        "\x7f",
        "\x7f",
        "git",
        " ",
        "\r",
      ]
    ) {
      io.input.write(key);
    }
    assertEquals(await selected, ["repair:docs", "enable:git"]);
    assertEquals(io.input.isRaw, false);
    assertEquals(io.input.listenerCount("keypress"), 0);
  } finally {
    io.close();
  }
});

Deno.test("portable action prompt safely handles unmatched literal filters and deselection", async () => {
  const io = terminal();
  try {
    const selected = selectTerminalActions(actions, io);
    await io.ready;
    for (const key of ["[", " ", "\x1b[A", "\x1b[B", "\x7f", " ", " ", "\r"]) {
      io.input.write(key);
    }
    assertEquals(await selected, []);
    assertStringIncludes(io.text(), "No matching actions.");
  } finally {
    io.close();
  }
});

for (const key of ["\x03", "\x04", "\x1b", "end"]) {
  Deno.test(`portable prompts cancel and restore input for ${JSON.stringify(key)}`, async () => {
    for (
      const prompt of [
        (io: ReturnType<typeof terminal>) => selectTerminalActions(actions, io),
        (io: ReturnType<typeof terminal>) => promptTerminalText("Scope", io),
      ]
    ) {
      const io = terminal();
      try {
        const result = prompt(io);
        await io.ready;
        if (key === "end") io.input.end();
        else io.input.write(key);
        assertEquals(await result, null);
        assertEquals(io.input.isRaw, false);
        assertEquals(io.input.listenerCount("keypress"), 0);
      } finally {
        io.close();
      }
    }
  });
}

Deno.test("portable text prompts accept edited explicit answers and never invent defaults", async () => {
  for (const [keys, expected] of [["publiX\x7fc\r", "public"], ["\r", ""]]) {
    const io = terminal();
    try {
      const result = promptTerminalText("Visibility", io);
      await io.ready;
      for (const key of keys) io.input.write(key);
      assertEquals(await result, expected);
    } finally {
      io.close();
    }
  }
  const io = terminal();
  io.input.isTTY = false;
  try {
    assertEquals(await promptTerminalText("Scope", io), null);
    await assertRejects(
      () => selectTerminalActions(actions, io),
      Error,
      "requires a TTY",
    );
    assertEquals(io.text(), "");
  } finally {
    io.close();
  }
});

Deno.test("cancelled action prompts cannot become an empty successful feature request", async () => {
  const io = terminal();
  try {
    const selected = promptFeatureActions(actions, io);
    await io.ready;
    io.input.write("\x03");
    await assertRejects(() => selected, PromptCancelled);
  } finally {
    io.close();
  }
});
