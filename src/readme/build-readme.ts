/** @module Builds README Markdown from local source files. */

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
  return await buildFile(
    root,
    { path: `${root}/${input}`, text },
    new Set(),
    await packageImports(root),
  );
}

async function buildFile(
  root: string,
  source: { readonly path: string; readonly text: string },
  stack: ReadonlySet<string>,
  imports: Awaited<ReturnType<typeof packageImports>>,
): Promise<string> {
  if (stack.has(source.path)) {
    throw new Error(`Circular README include: ${source.path}`);
  }
  const next = new Set(stack).add(source.path);
  const lines = source.text.split("\n");
  if (lines[0]?.startsWith("#!")) lines.shift();
  const output: string[] = [];
  let fenced = false;
  for (const line of lines) {
    if (/^\s*(?:```|~~~)/.test(line)) {
      fenced = !fenced;
      output.push(line);
      continue;
    }
    const included = includePath(line);
    if (included) {
      const file = await readReadmeFile(root, dirname(source.path), included);
      output.push(await buildFile(root, file, next, imports));
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
