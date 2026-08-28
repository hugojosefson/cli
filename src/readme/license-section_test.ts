import { assertEquals } from "@std/assert";
import {
  appendLicenseSection,
  exactLicenseSection,
  inspectLicenseSection,
  parseLicenseSections,
} from "./license-section.ts";

const own = exactLicenseSection("MIT", "./LICENSE");

Deno.test("renders a formatter-compatible terminal license section", () => {
  assertEquals(own, "## License\n\n[MIT](./LICENSE)\n");
  assertEquals(
    inspectLicenseSection(`${own}\n## Next\n`, "MIT", "./LICENSE", []).kind,
    "exact",
  );
});

Deno.test("parses only unfenced level-two License sections", () => {
  const text = `~~~markdown\n## License\n~~~\n\n${own}`;
  assertEquals(parseLicenseSections(text).length, 1);
  assertEquals(
    inspectLicenseSection(text, "MIT", "./LICENSE", []).kind,
    "exact",
  );
});

Deno.test("preserves CRLF offsets and classifies duplicates and custom sections", () => {
  const crlf = own.replaceAll("\n", "\r\n");
  assertEquals(parseLicenseSections(crlf).length, 1);
  assertEquals(
    inspectLicenseSection(`${own}${own}`, "MIT", "./LICENSE", []).kind,
    "duplicate",
  );
  assertEquals(
    inspectLicenseSection("## License\n\ntext\n", "MIT", "./LICENSE", []).kind,
    "custom",
  );
  assertEquals(appendLicenseSection("kept   ", own), `kept   \n\n${own}`);
  assertEquals(appendLicenseSection("kept\n\n", own), `kept\n\n${own}`);
  assertEquals(
    appendLicenseSection("kept\r\n", own),
    `kept\r\n\r\n${own.replaceAll("\n", "\r\n")}`,
  );
});
