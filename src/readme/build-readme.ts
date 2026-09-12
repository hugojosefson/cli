/** @module Builds README Markdown from local source files. */

import {
  type PackageMetadata,
  projectMetadata,
  validJsrName,
} from "../package/metadata.ts";
import { dirname, extname } from "@std/path";
import { rewriteMarkdownLinks } from "./markdown-link.ts";
import { packageImports, rewritePackageImport } from "./package-import.ts";
import { readmeRoot, readReadmeFile } from "./readme-path.ts";

export async function buildReadme(
  rootUrl: URL,
  input = "readme/README.md",
): Promise<string> {
  const root = await readmeRoot(rootUrl);
  const source = await readReadmeFile(root, root, input);
  return await buildReadmeText(rootUrl, source.text, input);
}

/** Builds output with replacement top-level source text before any files change. */
export async function buildReadmeText(
  rootUrl: URL,
  text: string,
  input = "readme/README.md",
): Promise<string> {
  const root = await readmeRoot(rootUrl);
  let metadata: Promise<PackageMetadata> | undefined;
  const readMetadata = () => metadata ??= projectMetadata(rootUrl);
  return await buildFile(
    root,
    { path: `${root}/${input}`, text },
    new Set(),
    await packageImports(root, readMetadata),
    readMetadata,
  );
}

async function buildFile(
  root: string,
  source: { readonly path: string; readonly text: string },
  stack: ReadonlySet<string>,
  imports: Awaited<ReturnType<typeof packageImports>>,
  metadata: () => Promise<PackageMetadata>,
): Promise<string> {
  if (stack.has(source.path)) {
    throw new Error(`Circular README include: ${source.path}`);
  }
  const next = new Set(stack).add(source.path);
  const lines = source.text.split("\n");
  if (lines[0]?.startsWith("#!")) lines.shift();
  const output: string[] = [];
  let fenced = false;
  for (const sourceLine of lines) {
    const line = sourceLine.includes("{{package.")
      ? resolvePackageReferences(sourceLine, await metadata())
      : sourceLine;
    if (/^\s*(?:```|~~~)/.test(line)) {
      fenced = !fenced;
      output.push(line);
      continue;
    }
    const included = includePath(line);
    if (included) {
      const file = await readReadmeFile(root, dirname(source.path), included);
      output.push(await buildFile(root, file, next, imports, metadata));
      continue;
    }
    const linked = fenced
      ? line
      : rewriteMarkdownLinks(line, source.path, root);
    output.push(
      isTypeScript(source.path)
        ? rewritePackageImport(linked, source.path, imports)
        : linked,
    );
  }
  return output.join("\n");
}

function includePath(line: string): string | undefined {
  const input = line.match(/^\s*@@include\(([^)]+)\)\s*$/)?.[1].trim();
  return input || undefined;
}

function isTypeScript(path: string): boolean {
  return [".ts", ".tsx", ".mts", ".cts"].includes(extname(path));
}

/** Explicit source references survive builds; unrelated prose stays unchanged. */
function resolvePackageReferences(
  line: string,
  metadata: PackageMetadata,
): string {
  const values: Record<string, string> = {
    name: metadata.name,
    command: metadata.command,
    url: `https://jsr.io/${metadata.name}`,
    api: `https://jsr.io/${metadata.name}/doc`,
    badge: `https://jsr.io/badges/${metadata.name}`,
    install:
      `deno install --global --name ${metadata.command} jsr:${metadata.name}/cli`,
    run: `deno run jsr:${metadata.name}/cli`,
  };
  return line.replaceAll(/\{\{package\.([^}]+)\}\}/g, (_match, key: string) => {
    if (!Object.hasOwn(values, key)) {
      throw new Error(`Unknown package reference: ${key}`);
    }
    if (!["name", "command"].includes(key) && !validJsrName(metadata.name)) {
      throw new Error(
        "Set an explicit scoped JSR name before generating registry references.",
      );
    }
    return values[key];
  });
}
