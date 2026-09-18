import { init, parse } from "es-module-lexer";

export async function jsrImportBytes(
  bytes: Uint8Array,
  path: string,
  resolve: (specifier: string, path: string) => string,
): Promise<Uint8Array> {
  if (!/\.(?:[cm]?[jt]s|[jt]sx)$/.test(path)) {
    return bytes;
  }
  const source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
    .decode(
      bytes,
    );
  await init();
  const [imports] = parse(source, path);
  const changes = imports.flatMap((entry) => {
    if (!entry.specifier || (entry.type === "dynamic" && entry.glob)) {
      return [];
    }
    const replacement = resolve(entry.specifier, path);
    if (replacement === entry.specifier) {
      return [];
    }
    const dynamic = entry.type === "dynamic";
    const start = entry.start + (dynamic ? 1 : 0);
    const end = entry.end - (dynamic ? 1 : 0);
    const quote = source[start - 1];
    if (quote !== '"' && quote !== "'" && quote !== "`") {
      throw new TypeError("JSR import delimiter is invalid.");
    }
    const text = replacement.replace(/\\/g, "\\\\")
      .replaceAll(quote, `\\${quote}`)
      .replace(/\r/g, "\\r").replace(/\n/g, "\\n")
      .replace(/\$\{/g, quote === "`" ? "\\${" : "${");
    return [{ start, end, text }];
  }).sort((a, b) => b.start - a.start);
  const transformed = changes.reduce(
    (text, change) =>
      text.slice(0, change.start) + change.text + text.slice(change.end),
    source,
  );
  return new TextEncoder().encode(transformed);
}
