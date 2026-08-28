/** @module Exact, unfenced README license-section parsing and edits. */

export type LicenseSection = {
  readonly start: number;
  readonly end: number;
  readonly text: string;
};

export type LicenseSectionState =
  | { readonly kind: "missing" }
  | { readonly kind: "exact"; readonly section: LicenseSection }
  | { readonly kind: "alternate"; readonly section: LicenseSection }
  | { readonly kind: "custom"; readonly section: LicenseSection }
  | {
    readonly kind: "duplicate";
    readonly sections: readonly LicenseSection[];
  };

export function exactLicenseSection(label: string, target: string): string {
  return `## License\n\n[${label}](${target})\n\n`;
}

/** Finds only level-two License headings outside matching backtick or tilde fences. */
export function parseLicenseSections(text: string): readonly LicenseSection[] {
  const headings: Array<
    { readonly offset: number; readonly license: boolean }
  > = [];
  let fence: { char: "`" | "~"; length: number } | undefined;
  for (const match of text.matchAll(/.*(?:\r\n|\n|\r|$)/g)) {
    const line = match[0];
    if (!line) continue;
    const body = line.replace(/\r?\n$|\r$/, "");
    const marker = /^\s*(`{3,}|~{3,})/.exec(body)?.[1];
    if (marker) {
      const char = marker[0] as "`" | "~";
      if (!fence) fence = { char, length: marker.length };
      else if (fence.char === char && marker.length >= fence.length) {
        fence = undefined;
      }
    } else if (!fence && /^##(?:\s|$)/.test(body)) {
      headings.push({
        offset: match.index!,
        license: /^## License(?:\s+#+)?\s*$/.test(body),
      });
    }
  }
  return headings.flatMap((heading, index) => {
    if (!heading.license) return [];
    const end = headings[index + 1]?.offset ?? text.length;
    return [{
      start: heading.offset,
      end,
      text: text.slice(heading.offset, end),
    }];
  });
}

export function inspectLicenseSection(
  text: string,
  label: string,
  target: string,
  alternateLabels: readonly string[],
): LicenseSectionState {
  const sections = parseLicenseSections(text);
  if (sections.length === 0) return { kind: "missing" };
  if (sections.length !== 1) return { kind: "duplicate", sections };
  const section = sections[0];
  const normalized = section.text.replaceAll("\r\n", "\n").replaceAll(
    "\r",
    "\n",
  );
  if (normalized === exactLicenseSection(label, target)) {
    return { kind: "exact", section };
  }
  if (
    alternateLabels.some((item) =>
      normalized === exactLicenseSection(item, target)
    )
  ) {
    return { kind: "alternate", section };
  }
  return { kind: "custom", section };
}

export function appendLicenseSection(text: string, section: string): string {
  if (!text) return section;
  const eol = preferredEol(text);
  const rendered = withEol(section, eol);
  const separator = text.endsWith(eol + eol)
    ? ""
    : text.endsWith("\n") || text.endsWith("\r")
    ? eol
    : eol + eol;
  return `${text}${separator}${rendered}`;
}

export function replaceLicenseSection(
  text: string,
  current: LicenseSection,
  replacement: string,
): string {
  return text.slice(0, current.start) +
    withEol(replacement, preferredEol(current.text)) + text.slice(current.end);
}

function preferredEol(text: string): "\n" | "\r\n" {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function withEol(text: string, eol: "\n" | "\r\n"): string {
  return eol === "\n" ? text : text.replaceAll("\n", "\r\n");
}

export function removeLicenseSection(
  text: string,
  current: LicenseSection,
): string {
  return text.slice(0, current.start) + text.slice(current.end);
}
