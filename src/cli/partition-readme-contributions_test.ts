import { assertEquals, assertStringIncludes } from "@std/assert";
import type { ChangePlan } from "../api/change-plan.ts";
import { partitionReadmeContributions } from "./partition-readme-contributions.ts";

const requirement = block("readme:requirements", "## Requirements\nDeno");
const example = block("deno-lib:example", "## Example\nUse the library.");
const api = block("jsr-package:api", "## API\nRead the API.");
const full = `# Package\n\n${requirement}\n${api}\n${example}`;
const file = (text: string) => ({
  bytes: new TextEncoder().encode(text),
  mode: "100644",
});
const decode = (value: ReturnType<typeof file> | undefined) =>
  value ? new TextDecoder().decode(value.bytes) : "";

Deno.test("cumulative README snapshots keep additions with each owner and restore earlier contributions", () => {
  const features = [
    feature("deno-lib", full),
    feature("readme-static", `# Package\n\n${requirement}`),
    feature("jsr-package", full),
  ];
  partitionReadmeContributions(
    new Map(),
    features,
    new Map([["README.md", file(full)]]),
  );
  const library = decode(features[0].files.get("README.md"));
  assertStringIncludes(library, example);
  assertEquals(library.includes(requirement), false);
  assertEquals(library.includes(api), false);
  const provider = decode(features[1].files.get("README.md"));
  assertStringIncludes(provider, requirement);
  assertStringIncludes(provider, example);
  assertEquals(provider.includes(api), false);
  assertEquals(decode(features[2].files.get("README.md")), full);
});

Deno.test("README removals wait for their owning feature and retain unrelated prose", () => {
  const final = `# Package\n\n${requirement}\nCustom text.\n`;
  const baseline =
    `# Package\n\n${requirement}\n${api}\n${example}\nCustom text.\n`;
  const features = [feature("deno-lib", final), feature("jsr-package", final)];
  partitionReadmeContributions(
    new Map([["README.md", file(baseline)]]),
    features,
    new Map([["README.md", file(final)]]),
  );
  const library = decode(features[0].files.get("README.md"));
  assertEquals(library.includes(example), false);
  assertStringIncludes(library, api);
  assertStringIncludes(library, "Custom text.");
  assertEquals(decode(features[1].files.get("README.md")), final);
});

function feature(featureId: string, text: string) {
  const plan: ChangePlan = {
    featureId,
    action: "enable",
    summary: "",
    warnings: [],
    preconditions: [],
    validations: [],
    changes: [],
  };
  return { plan, files: new Map([["README.md", file(text)]]) };
}
function block(id: string, content: string) {
  return `<!-- hj:readme ${id} aabbcc -->\n${content}\n<!-- /hj:readme -->\n`;
}
