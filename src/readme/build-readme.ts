/** @module Builds README Markdown from local source files. */

import {
  type PackageMetadata,
  projectMetadata,
  validJsrName,
} from "../package/metadata.ts";
import { dirname, extname, isAbsolute, relative, resolve } from "@std/path";
import { rewriteMarkdownLinks } from "./markdown-link.ts";
import { packageImports, rewritePackageImport } from "./package-import.ts";
import { rehashBlocks, unchangedBlocks } from "./contribution-blocks.ts";
import { guideStatePath, installPath } from "./guide-files.ts";
import { readmeRoot, readReadmeFile } from "./readme-path.ts";

export async function buildReadme(
  rootUrl: URL,
  input = "readme/README.md",
): Promise<string> {
  const root = await readmeRoot(rootUrl);
  const source = await readReadmeFile(root, root, input);
  return await buildReadmeText(rootUrl, source.text, input);
}

/** Optional projected inputs keep feature planning free of filesystem writes. */
export interface ReadmeBuildInputs {
  readonly metadata?: PackageMetadata;
  readonly readFile?: (path: string) => Promise<string | undefined>;
}

/** Builds output with replacement top-level source text before any files change. */
export async function buildReadmeText(
  rootUrl: URL,
  text: string,
  input = "readme/README.md",
  inputs: ReadmeBuildInputs = {},
): Promise<string> {
  const root = await readmeRoot(rootUrl);
  let metadata: Promise<PackageMetadata> | undefined;
  const readMetadata = () =>
    metadata ??= inputs.metadata
      ? Promise.resolve(inputs.metadata)
      : projectMetadata(rootUrl);
  const output = await buildFile(
    root,
    { path: `${root}/${input}`, text },
    new Set(),
    await packageImports(root, readMetadata),
    readMetadata,
    inputs.readFile,
  );
  return await rehashBlocks(output, await unchangedBlocks(text));
}

async function buildFile(
  root: string,
  source: { readonly path: string; readonly text: string },
  stack: ReadonlySet<string>,
  imports: Awaited<ReturnType<typeof packageImports>>,
  metadata: () => Promise<PackageMetadata>,
  readFile?: ReadmeBuildInputs["readFile"],
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
      const path = resolve(dirname(source.path), included);
      const fromRoot = relative(root, path);
      if (
        isAbsolute(included) || fromRoot === ".." ||
        fromRoot.startsWith("../") || !fromRoot || included.includes("\0")
      ) throw new Error("README path escapes repository root.");
      let file = readFile
        ? { path, text: await readFile(fromRoot) }
        : await readReadmeFile(root, dirname(source.path), included);
      if (!readFile && fromRoot === installPath) {
        try {
          const ownership = JSON.parse(
            (await readReadmeFile(root, root, guideStatePath)).text,
          );
          if (
            ownership.version === 1 &&
            ownership.files?.[installPath] === file.text
          ) {
            const name = (await metadata()).name;
            if (!validJsrName(name)) {
              throw new Error(
                "Set a scoped package name before building installation guides.",
              );
            }
            file = {
              ...file,
              text: `#!/usr/bin/env bash\ndeno add jsr:${name}\n`,
            };
          }
        } catch (error) {
          if (!(error instanceof Deno.errors.NotFound)) throw error;
        }
      }
      if (file.text === undefined) {
        throw new Error(`Missing README include: ${included}`);
      }
      output.push(
        await buildFile(
          root,
          { path: file.path, text: file.text },
          next,
          imports,
          metadata,
          readFile,
        ),
      );
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
