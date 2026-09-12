/** @module Deno package export lookup for README source snippets. */

import { dirname, isAbsolute, relative, resolve, toFileUrl } from "@std/path";
import {
  type PackageMetadata,
  projectMetadata,
  validJsrName,
} from "../package/metadata.ts";

export type PackageImports = ReadonlyMap<string, string>;

export async function packageImports(
  root: string,
  readMetadata: () => Promise<PackageMetadata> = () =>
    projectMetadata(toFileUrl(root + "/")),
): Promise<PackageImports> {
  try {
    const metadata = await readMetadata();
    if (!metadata.configured || !validJsrName(metadata.name)) return new Map();
    return exportsFor(root, { ...metadata.config, name: metadata.name }) ??
      new Map();
  } catch {
    return new Map();
  }
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
