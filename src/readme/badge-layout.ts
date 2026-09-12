/** @module Shared README badge ordering and placement without claiming custom badges. */

/** Markers may surround block content or appear inline between badges. */
export const contributionPattern =
  /<!-- hj:readme ([\w:-]+) ([a-f0-9]+) -->([\s\S]*?)<!-- \/hj:readme -->/g;

const start = "<!-- deno-fmt-ignore-start -->";
const end = "<!-- deno-fmt-ignore-end -->";
const target = String.raw`\((?:[^()\n]|\([^()\n]*\))*\)|\[[^\]\n]*\]`;
const image = String.raw`!\[[^\]\n]*\](?:${target})`;
const badgePattern = new RegExp(
  String
    .raw`\[${image}\](?:${target})|${image}|<a\b[^>]*>\s*<img\b[^>]*>\s*</a>|<img\b[^>]*>`,
  "gi",
);

function isBadge(text: string, document: string): boolean {
  const references = [...text.matchAll(/\[([^\]\n]+)\]/g)].map((match) =>
    match[1].toLowerCase()
  );
  const destinations = document.split("\n").filter((line) => {
    const label = /^ {0,3}\[([^\]]+)\]:/.exec(line)?.[1].toLowerCase();
    return label && references.includes(label);
  }).join(" ");
  return /badge|shields\.io|badgen\.net|coveralls\.io/i.test(
    text + destinations,
  ) ||
    /(?:!\[|alt=["'])(?:ci|npm|jsr|build|status|coverage|license|version|score)(?:[\]"' ]|$)/i
      .test(text);
}

interface Badge {
  start: number;
  end: number;
  text: string;
  owner?: string;
}

/** Keep fenced examples, inline code, comments and non-badge owned sections intact. */
function visibleText(text: string): string {
  let fence: string | undefined;
  return text.split(/(?<=\n)/).map((line) => {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    const hidden = !!fence || !!marker || /^(?: {4}|\t)/.test(line);
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) {
        fence = undefined;
      }
    }
    return hidden ? line.replace(/[^\n]/g, " ") : line;
  }).join("").replace(/(`+)[^\n]*?\1/g, (code) => " ".repeat(code.length));
}

function badges(text: string): Badge[] {
  let visible = visibleText(text);
  const result: Badge[] = [];
  for (const match of visible.matchAll(contributionPattern)) {
    const body = match[3].trim();
    if (
      /:badges?$/.test(match[1]) && body.replace(badgePattern, "").trim() === ""
    ) {
      result.push({
        start: match.index!,
        end: match.index! + match[0].length,
        text: text.slice(match.index!, match.index! + match[0].length),
        owner: match[1].split(":")[0],
      });
    }
    visible = visible.slice(0, match.index!) +
      match[0].replace(/[^\n]/g, " ") +
      visible.slice(match.index! + match[0].length);
  }
  visible = visible.replace(
    /<!--[\s\S]*?-->/g,
    (comment) => comment.replace(/[^\n]/g, " "),
  );
  for (const match of visible.matchAll(badgePattern)) {
    // A linked screenshot is still an illustration. Recognize badge labels,
    // provider URLs and reference destinations without adopting their ownership.
    if (!isBadge(match[0], text)) continue;
    result.push({
      start: match.index!,
      end: match.index! + match[0].length,
      text: text.slice(match.index!, match.index! + match[0].length),
    });
  }
  return result.sort((a, b) => a.start - b.start);
}

function order(badge: Badge): string {
  const owner = badge.owner === "jsr-package"
    ? "github-release-publish-jsr"
    : badge.owner;
  return owner?.startsWith("github-release-publish-")
    ? `0:${owner}`
    : owner
    ? `1:${owner}`
    : "2:";
}

/** Locate the first prose paragraph, skipping titles, metadata and other blocks. */
function paragraphEnd(text: string): number {
  const visible = visibleText(text).replace(
    /<!--[\s\S]*?-->/g,
    (comment) => comment.replace(/[^\n]/g, " "),
  );
  let offset = 0;
  let frontmatter = visible.startsWith("---\n");
  for (const block of visible.split(/\n[ \t]*\n/)) {
    const at = visible.indexOf(block, offset);
    offset = at + block.length;
    if (frontmatter) {
      const close = block.indexOf("\n---", 3);
      if (close >= 0) frontmatter = false;
      continue;
    }
    const body = block.trim();
    if (
      !body ||
      /^(?:#{1,6}\s|[>|]|[-*+]\s|\d+[.)]\s|@@include\(|<|\[[^\]]+\]:)/.test(
        body,
      ) || /\n[=-]+\s*$/.test(body)
    ) continue;
    return offset;
  }
  const title = /^# .*(?:\n|$)/m.exec(visible);
  return title ? title.index! + title[0].trimEnd().length : 0;
}

/** Returns a stable single-line badge row directly after the introduction. */
export function layoutBadges(text: string): string {
  const found = badges(text);
  if (!found.length) {
    return text.replace(new RegExp(`${start}\\s*${end}\\n?`, "g"), "");
  }
  const removed = "\0hj-badge\0";
  let remaining = text;
  for (const badge of [...found].reverse()) {
    remaining = remaining.slice(0, badge.start) + removed +
      remaining.slice(badge.end);
  }
  // Retire only a formatter wrapper containing badges and whitespace.
  remaining = remaining.replace(
    new RegExp(`${start}\\s*(?:${removed}\\s*)+${end}`, "g"),
    removed,
  );
  const gaps = new RegExp(`[ \\t\\r\\n]*(?:${removed}[ \\t\\r\\n]*)+`, "g");
  remaining = remaining.replace(gaps, (gap, at: number) => {
    if (gap.includes("\n")) {
      return at === 0
        ? ""
        : at + gap.length === remaining.length
        ? "\n"
        : "\n\n";
    }
    return /\s/.test(gap) ? " " : "";
  });
  const row = found.sort((a, b) => order(a).localeCompare(order(b)))
    .map((badge) => badge.text.replace(/\s+/g, " ").trim()).join(" ");
  // An initial comment must be a separate HTML block so the badges render as Markdown.
  const rendered = row.replace(
    /^(<!-- hj:readme [\w:-]+ [a-f0-9]+ -->) /,
    "$1\n\n",
  );
  const at = paragraphEnd(remaining);
  const before = remaining.slice(0, at).trimEnd();
  const after = remaining.slice(at).replace(/^\s*\n/, "");
  const result = (before ? before + "\n\n" : "") + start + "\n" + rendered +
    "\n" +
    end + "\n" +
    (after ? "\n" + after : "");
  const withoutWrapper = (value: string) =>
    value.replaceAll(start + "\n", "").replaceAll("\n" + end, "");
  return withoutWrapper(result) === withoutWrapper(text) ? text : result;
}

/** Specific repair details, including the resulting badge identities and order. */
export function badgeLayoutResolution(text: string, path: string): string {
  const names = badges(text).sort((a, b) => order(a).localeCompare(order(b)))
    .map((badge) => badge.owner ?? badge.text);
  return `Move all badges in ${path} onto one horizontal line immediately after the first paragraph. ` +
    `Set badge order to: ${
      names.join("; ")
    }. Preserve badge links and ownership comments.`;
}
