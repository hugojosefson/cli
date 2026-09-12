/** Locate Markdown headings and entries outside fenced code examples. */
export type MarkdownLine = { readonly text: string; readonly offset: number };
export function changelogLines(text: string): readonly MarkdownLine[] {
  const lines: MarkdownLine[] = [];
  let offset = 0;
  let fence: { character: string; length: number } | undefined;
  for (const line of text.split(/(?<=\n)/)) {
    const value = line.replace(/\r?\n$/, "");
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(value);
    if (fence) {
      if (
        marker && marker[1][0] === fence.character &&
        marker[1].length >= fence.length && !marker[2].trim()
      ) fence = undefined;
    } else if (marker) {
      fence = { character: marker[1][0], length: marker[1].length };
    } else if (!/^ {4}|^\t/.test(value)) {
      lines.push({ text: value, offset });
    }
    offset += line.length;
  }
  return lines;
}

export function changelogHeadings(
  text: string,
): readonly {
  readonly title: string;
  readonly level: number;
  readonly offset: number;
}[] {
  return changelogLines(text).flatMap((line) => {
    const heading = /^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/.exec(
      line.text,
    );
    return heading
      ? [{ title: heading[2], level: heading[1].length, offset: line.offset }]
      : [];
  });
}
