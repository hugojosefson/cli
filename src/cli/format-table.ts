/** Plain text tables for terminals and redirected output. */
export function formatTable(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  limits: readonly number[] = headers.map(() => 64),
): string {
  const clean = (value: string) =>
    value
      // deno-lint-ignore no-control-regex -- Remove terminal escape sequences.
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
      // deno-lint-ignore no-control-regex -- Remove control bytes from table data.
      .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "")
      .replace(/\t/g, " ");
  const values = [headers, ...rows].map((row) =>
    headers.map((_, i) => clean(row[i] ?? ""))
  );
  const widths = headers.map((header, i) => {
    const longest = Math.max(
      ...values.flatMap((row) => row[i].split("\n").map((line) => line.length)),
    );
    return Math.max(1, header.length, Math.min(limits[i] ?? 64, longest));
  });
  const wrap = (text: string, width: number): string[] =>
    text.split("\n").flatMap((line) => {
      const result: string[] = [];
      let rest = line.trim();
      while (rest.length > width) {
        const space = rest.lastIndexOf(" ", width);
        const end = space > 0 ? space : width;
        result.push(rest.slice(0, end));
        rest = rest.slice(end).trimStart();
      }
      return [...result, rest];
    });
  const render = (row: readonly string[]) => {
    const cells = row.map((cell, i) => wrap(cell, widths[i]));
    return Array.from(
      { length: Math.max(...cells.map((cell) => cell.length)) },
      (_, line) =>
        cells.map((cell, i) => (cell[line] ?? "").padEnd(widths[i])).join("  ")
          .trimEnd(),
    );
  };
  return [
    ...render(values[0]),
    widths.map((width) => "-".repeat(width)).join("  "),
    ...values.slice(1).flatMap(render),
  ].join("\n");
}
