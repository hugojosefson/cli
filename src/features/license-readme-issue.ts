/** @module README findings for recognized SPDX licenses. */

import type { DetectionIssue } from "../api/feature-detection.ts";
import type { LicenseReadmeState } from "./license-readme-state.ts";

export function licenseReadmeIssue(
  readme: LicenseReadmeState,
  id: string,
  label: string,
): DetectionIssue {
  const section = readme.section;
  const line = (offset: number) =>
    (readme.content ?? "").slice(0, offset).split(/\r\n|\n|\r/).length;
  const target = readme.mode === "generated" ? "../LICENSE" : "./LICENSE";
  const link = `[${label}](${target})`;
  const expected = `one ## License heading with only ${link} below it`;
  const body = section.kind === "custom"
    ? section.section.text.replace(/^.*(?:\r\n|\n|\r)/, "").trim()
    : "";
  const found = section.kind === "duplicate"
    ? `duplicate ## License headings at lines ${
      section.sections.map((item) => line(item.start)).join(", ")
    }`
    : body === label
    ? `plain ${label} text at line ${
      section.kind === "custom" ? line(section.section.start) : 1
    }`
    : /^\[[A-Za-z0-9.-]+\]\((?:\.{1,2}\/)?LICENSE\)$/.test(body)
    ? body
    : section.kind === "custom"
    ? `custom section content at line ${
      line(section.section.start)
    }; first character ${JSON.stringify(body[0] ?? "")}`
    : section.kind;
  return {
    code: `${id}-readme-conflict`,
    kind: id,
    subject: { kind: "repository-path", identifier: readme.path },
    observation:
      `LICENSE matches ${label}. ${readme.path}: expected ${expected}. Found ${found}.`,
    resolution:
      "Automatic repair is unavailable for custom license sections. " +
      `To use the managed section, keep ${expected}. Preserve intentional custom terms outside that section.`,
  };
}
