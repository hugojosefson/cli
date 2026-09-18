import { posix } from "node:path";
import { parse, type ParseError } from "jsonc-parser";
import type { PackageFileReader } from "./publish-jsr.ts";

type ImportMap = Record<string, unknown>;
const root = new URL("file:///package/");

export async function jsrImportMap(
  config: ImportMap,
  files: PackageFileReader,
): Promise<(specifier: string, path: string) => string> {
  const external = !config.imports && !config.scopes && config.importMap;
  const base = typeof external === "string" ? new URL(external, root) : root;
  if (!base.href.startsWith(root.href)) {
    throw new TypeError("JSR import map must be a local package file.");
  }
  const errors: ParseError[] = [];
  const map = external
    ? parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        await files.read(base.href.slice(root.href.length)),
      ),
      errors,
    )
    : config;
  if (errors.length || !record(map)) {
    throw new TypeError("JSR import map is invalid.");
  }
  return (specifier, path) => {
    const referrer = new URL(path, root);
    const normalized = urlLike(specifier)
      ? new URL(specifier, referrer).href
      : specifier;
    const scopes = Object.entries(record(map.scopes) ?? {})
      .map(([scope, imports]) => [new URL(scope, base).href, imports] as const)
      .filter(([scope]) =>
        referrer.href === scope ||
        (scope.endsWith("/") && referrer.href.startsWith(scope))
      ).sort(([a], [b]) => b.length - a.length);
    for (
      const imports of [...scopes.map(([, entries]) => entries), map.imports]
    ) {
      const resolved = resolve(normalized, record(imports) ?? {}, base);
      if (resolved === undefined) {
        continue;
      }
      if (!resolved.startsWith(root.href)) {
        return resolved;
      }
      const relative = posix.relative(
        posix.dirname(referrer.pathname),
        new URL(resolved).pathname,
      );
      return relative.startsWith(".") ? relative : `./${relative}`;
    }
    return specifier;
  };
}

function resolve(specifier: string, imports: ImportMap, base: URL) {
  const entries = Object.entries(imports).map(([key, value]) =>
    [urlLike(key) ? new URL(key, base).href : key, value] as const
  ).sort(([a], [b]) => b.length - a.length);
  for (const [key, value] of entries) {
    const packagePrefix = typeof value === "string" &&
      /^(?:jsr|npm):[^/].*[^/]$/.test(value);
    const prefix = key.endsWith("/") ? key : `${key}/`;
    if (
      specifier !== key &&
      !((key.endsWith("/") || packagePrefix) && specifier.startsWith(prefix))
    ) {
      continue;
    }
    if (typeof value !== "string") {
      throw new TypeError("JSR import map entry is invalid.");
    }
    if (specifier === key) {
      return new URL(value, base).href;
    }
    const target = value.endsWith("/") ? value : `${value}/`;
    const packageAddress = target.replace(/^(jsr|npm):([^/])/, "$1:/$2");
    const address = new URL(packageAddress, base);
    const resolved = new URL(specifier.slice(prefix.length), address);
    if (!resolved.href.startsWith(address.href)) {
      throw new TypeError("JSR import map target leaves its prefix.");
    }
    // Node escapes carets in URL paths. Preserve Deno package version ranges.
    return /^(?:jsr|npm):/.test(target)
      ? packageAddress + resolved.href.slice(address.href.length)
      : resolved.href;
  }
  return undefined;
}

function record(value: unknown): ImportMap | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as ImportMap
    : undefined;
}

function urlLike(value: string): boolean {
  return /^(?:[a-z][a-z\d+.-]*:|\.{0,2}\/)/i.test(value);
}
