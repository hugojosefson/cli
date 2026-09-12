/** @module Individually owned README blocks that preserve user edits. */
import { digestBytes } from "../repository/digest-bytes.ts";

const pattern =
  /<!-- hj:readme ([\w:-]+) ([a-f0-9]+) -->\n([\s\S]*?)\n<!-- \/hj:readme -->\n?/g;
export interface ReadmeContribution {
  readonly id: string;
  readonly content: string;
  readonly position: "badges" | "section";
}

export async function blockHash(content: string): Promise<string> {
  return await digestBytes(new TextEncoder().encode(content));
}

/** Markdown formatters wrap prose and surround HTML blocks with blank lines.
 * Keep those presentation changes separate from code and text edits. */
async function contributionHash(content: string): Promise<string> {
  const parts = content.split(/(^[ \t]*```[^\n]*\n[\s\S]*?^[ \t]*```[ \t]*$)/m);
  const normalized = parts.map((part) => {
    const code = /^([ \t]*```[^\n]*\n)([\s\S]*?)(\n[ \t]*```[ \t]*)$/.exec(
      part,
    );
    return code
      ? code[1] + code[2].replace(/^\n+|\n+$/g, "") + code[3]
      : part.replace(/\s+/g, " ").trim();
  });
  return await blockHash(JSON.stringify(normalized));
}

/** Return identities whose complete body still matches its ownership marker. */
export async function unchangedBlocks(text: string): Promise<Set<string>> {
  const result = new Set<string>();
  for (const match of text.matchAll(pattern)) {
    if (await contributionHash(match[3]) === match[2]) result.add(match[1]);
  }
  return result;
}

export async function rehashBlocks(
  text: string,
  ids: ReadonlySet<string>,
): Promise<string> {
  for (const match of [...text.matchAll(pattern)]) {
    if (ids.has(match[1])) {
      text = text.replace(
        match[0],
        match[0].replace(match[2], await contributionHash(match[3])),
      );
    }
  }
  return text;
}

/** Replace/remove only unchanged bodies. Existing sections prevent duplicates. */
export async function reconcileBlocks(
  text: string,
  desired: readonly ReadmeContribution[],
  owner?: string,
): Promise<string> {
  const install =
    text.split(/^## /m).find((section) =>
      /^(?:Install|Installation)\s*\n/.test(section)
    ) ?? "";
  const pending = new Map(
    desired.filter((item) =>
      (item.id !== "jsr-package:installation" ||
        !/^## Install\s*$/im.test(text)) &&
      (item.id !== "readme:requirements" ||
        !/\[Deno\]\(https:\/\/deno\.com\/?\)/.test(install))
    ).map((item) => [item.id, item]),
  );
  for (const match of [...text.matchAll(pattern)]) {
    if (owner && !match[1].startsWith(owner + ":")) continue;
    const item = pending.get(match[1]);
    pending.delete(match[1]);
    if (await contributionHash(match[3]) !== match[2]) continue;
    if (item && await contributionHash(item.content) === match[2]) continue;
    if (item) text = text.replace(match[0], await wrap(item));
    else {
      const at = text.indexOf(match[0]);
      const before = text.slice(0, at).replace(/\n+$/, "");
      const after = text.slice(at + match[0].length).replace(/^\n+/, "");
      text = before + (after ? "\n\n" + after : "\n");
    }
  }
  for (const item of pending.values()) {
    // A removed marker does not make an existing section available for takeover.
    if (
      item.id === "deno-cli:installation" &&
      (text.includes("To install the command:") ||
        text.includes("deno install --global"))
    ) continue;
    const heading = /^## .+$/m.exec(item.content)?.[0];
    if (heading && text.split("\n").includes(heading)) continue;
    if (
      item.position === "badges" &&
      (item.id.startsWith("jsr-package")
        ? text.includes("[![JSR")
        : item.id === "github-ci:badge"
        ? text.includes("[![CI]")
        : npmBadgeImages(text).length > 0)
    ) continue;
    const block = await wrap(item);
    if (item.position === "badges") {
      const section = text.search(/^## /m);
      const marker = text.indexOf("<!-- hj:readme ");
      let at = Math.min(
        section < 0 ? text.length : section,
        marker < 0 ? text.length : marker,
      );
      const order = [
        "jsr-package:badges",
        "github-release-publish-npm:badge",
        "github-ci:badge",
      ];
      const earlier = [...text.matchAll(pattern)].filter((match) =>
        order.indexOf(match[1]) >= 0 &&
        order.indexOf(match[1]) < order.indexOf(item.id)
      ).at(-1);
      if (earlier) at = earlier.index! + earlier[0].length;
      text = insert(text, at, block);
    } else {
      const order = [
        "readme:requirements",
        "deno-lib:api",
        "jsr-package:installation",
        "deno-cli:installation",
        "deno-lib:example",
      ];
      const later = order.slice(order.indexOf(item.id) + 1).map((id) =>
        text.indexOf(`<!-- hj:readme ${id} `)
      ).filter((at) => at >= 0);
      const license = text.search(/^## License\s*$/im);
      const at = Math.min(...later, license < 0 ? text.length : license);
      text = insert(text, at, block);
    }
  }
  return text;
}

async function wrap(item: ReadmeContribution): Promise<string> {
  return `<!-- hj:readme ${item.id} ${await contributionHash(
    item.content,
  )} -->\n${item.content}\n<!-- /hj:readme -->\n`;
}
function insert(text: string, at: number, block: string): string {
  const before = text.slice(0, at).replace(/\n*$/, "");
  const after = text.slice(at);
  return before + "\n\n" + block + (after ? "\n" + after : "");
}

/** Inspect one owned contribution without treating edited bodies as generated. */
export async function inspectContribution(
  text: string,
  desired: ReadmeContribution,
) {
  const matches = [...text.matchAll(pattern)].filter((match) =>
    match[1] === desired.id
  );
  const markers = text.split(`<!-- hj:readme ${desired.id} `).length - 1;
  if (markers > 1) return "duplicate";
  const match = matches[0];
  if (!match) {
    return text.includes(`<!-- hj:readme ${desired.id} `) ? "custom" : "absent";
  }
  if (await contributionHash(match[3]) !== match[2]) return "custom";
  return await contributionHash(desired.content) === match[2]
    ? "exact"
    : "stale";
}

/** Recognize npm badge images without claiming ownership of custom Markdown. */
export function npmBadgeImages(text: string): readonly string[] {
  return [...text.matchAll(/!\[([^\]]*)\]\(([^)\n]+)\)/g)].filter((match) =>
    /^npm(?: version)?$/i.test(match[1]) ||
    match[2].startsWith("https://img.shields.io/npm/v/")
  ).map((match) => match[0]);
}
