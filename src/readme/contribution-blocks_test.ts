import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  reconcileBlocks,
  rehashBlocks,
  unchangedBlocks,
} from "./contribution-blocks.ts";

Deno.test("contribution blocks retain custom bodies and remove only unchanged owned content", async () => {
  const desired = [{
    id: "jsr-package:api",
    content: "## API\n\nGenerated API.",
    position: "section" as const,
  }];
  const initial = await reconcileBlocks(
    "# Project\n\nIntroduction.\n\n## License\n\nMIT\n",
    desired,
  );
  assertEquals(await unchangedBlocks(initial), new Set(["jsr-package:api"]));
  assertEquals(await reconcileBlocks(initial, desired), initial);
  const custom = initial.replace("Generated API.", "Edited API.");
  assertEquals(await reconcileBlocks(custom, []), custom);
  assertEquals(await reconcileBlocks(custom, desired), custom);
  const removed = await reconcileBlocks(initial, []);
  assert(!removed.includes("## API"));
  assertStringIncludes(removed, "Introduction.");
  assertStringIncludes(removed, "## License");
  const rendered = await rehashBlocks(custom, new Set(["jsr-package:api"]));
  assertEquals(await unchangedBlocks(rendered), new Set(["jsr-package:api"]));
});

Deno.test("badges do not nest ownership markers and customized sections prevent duplicates", async () => {
  let text = await reconcileBlocks("# Project\n\nIntro.\n", [{
    id: "readme:requirements",
    content: "## Requirements\n\nDeno.",
    position: "section",
  }]);
  text = await reconcileBlocks(text, [{
    id: "jsr-package:badges",
    content: "[![JSR Version](version)](package)",
    position: "badges",
  }], "jsr-package");
  assertEquals((await unchangedBlocks(text)).size, 2);
  assert(text.indexOf("[![JSR") < text.indexOf("## Requirements"));
  assertEquals(
    await reconcileBlocks("# X\n\n## API\nCustom.\n", [{
      id: "jsr-package:api",
      content: "## API\nGenerated.",
      position: "section",
    }]),
    "# X\n\n## API\nCustom.\n",
  );
  assertEquals(
    await reconcileBlocks("# X\n\n[![CI](custom)](custom)\n", [{
      id: "github-ci:badge",
      content: "[![CI](generated)](generated)",
      position: "badges",
    }]),
    "# X\n\n[![CI](custom)](custom)\n",
  );
});

Deno.test("ownership tolerates prose wrapping while code string edits remain custom", async () => {
  const original = await reconcileBlocks("# Package\n", [{
    id: "deno-lib:example",
    position: "section",
    content:
      '## Example usage\n\nAn example with a visible result.\n\n```typescript\nconst result = "one two";\nconsole.dir({ result });\n```',
  }]);
  const wrapped = original.replace(
    "An example with a visible result.",
    "An example with a\nvisible result.",
  ).replace(" -->\n", " -->\n\n").replace("\n<!-- /hj", "\n\n<!-- /hj");
  assertEquals(await unchangedBlocks(wrapped), new Set(["deno-lib:example"]));
  const edited = wrapped.replace('"one two"', '"one  two"');
  assertEquals((await unchangedBlocks(edited)).size, 0);
  assertEquals(await reconcileBlocks(edited, []), edited);
});
