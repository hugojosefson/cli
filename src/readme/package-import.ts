/** @module Deno package export lookup for README source snippets. */

import { dirname, isAbsolute, relative, resolve } from "@std/path";
import { parse, type ParseError } from "jsonc-parser";

export type PackageImports = ReadonlyMap<string, string>;

export async function packageImports(root: string): Promise<PackageImports> {
  const configs: unknown[] = [];
  for (const name of ["deno.json", "deno.jsonc"]) {
    const path = resolve(root, name);
    try {
      if (!(await Deno.lstat(path)).isFile) continue;
      const errors: ParseError[] = [];
      const config = parse(await Deno.readTextFile(path), errors) as unknown;
      if (errors.length) return new Map();
      configs.push(config);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) continue;
      return new Map();
    }
  }
  return configs.length === 1
    ? exportsFor(root, configs[0]) ?? new Map()
    : new Map();
}

export function rewritePackageImport(
  line: string,
  file: string,
  imports: PackageImports,
): string {
  if (/^\s*import\s*["']/.test(line)) {
    return rewriteSideEffect(line, file, imports);
  }
  if (
    !/^\s*(?:import(?:\s+type)?\s+.+\s+from|export(?:\s+type)?\s+(?:\*|{[^}]*})\s+from)/
      .test(line)
  ) {
    return line;
  }
  return line.replaceAll(
    /(\sfrom\s+["'])(\.{1,2}\/[^"']+)(["'])/g,
    (match, start: string, specifier: string, end: string): string =>
      rewriteSpecifier(match, start, specifier, end, file, imports),
  );
}

function rewriteSideEffect(
  line: string,
  file: string,
  imports: PackageImports,
): string {
  return line.replace(
    /(^\s*import\s*["'])(\.{1,2}\/[^"']+)(["'])/,
    (match, start: string, specifier: string, end: string): string =>
      rewriteSpecifier(match, start, specifier, end, file, imports),
  );
}

function rewriteSpecifier(
  match: string,
  start: string,
  specifier: string,
  end: string,
  file: string,
  imports: PackageImports,
): string {
  const packageSpecifier = imports.get(resolve(dirname(file), specifier));
  return packageSpecifier ? `${start}${packageSpecifier}${end}` : match;
}

function exportsFor(root: string, value: unknown): PackageImports | undefined {
  if (!isObject(value) || typeof value.name !== "string" || !value.name) return;
  const exports = value.exports;
  const entries = typeof exports === "string"
    ? [[".", exports]]
    : isObject(exports)
    ? Object.entries(exports)
    : [];
  const result = new Map<string, string>();
  for (const [key, target] of entries) {
    if (
      typeof target !== "string" || !target.startsWith("./") ||
      (key !== "." && !key.startsWith("./"))
    ) {
      continue;
    }
    const path = resolve(root, target);
    const fromRoot = relative(root, path);
    if (
      fromRoot === ".." || fromRoot.startsWith("../") || isAbsolute(fromRoot)
    ) continue;
    result.set(
      path,
      key === "." ? value.name : `${value.name}/${key.slice(2)}`,
    );
  }
  return result;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
