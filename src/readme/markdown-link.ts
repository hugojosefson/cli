/** @module Markdown link paths relative to a repository root. */

import { fromFileUrl, relative, toFileUrl } from "@std/path";

export function rewriteMarkdownLinks(
  line: string,
  file: string,
  root: string,
): string {
  return line.split(/(`[^`]*`)/).map((part, index) =>
    index % 2 ? part : rewriteLinks(part, file, root)
  ).join("");
}

function rewriteLinks(line: string, file: string, root: string): string {
  return line.replaceAll(
    /(\]\()([^\s)]+)((?:\s+"[^"]*")?\))/g,
    (match, start: string, target: string, end: string): string => {
      if (
        target.startsWith("#") || target.startsWith("/") ||
        /^[a-z][a-z0-9+.-]*:/i.test(target) || /%(?![0-9a-f]{2})/i.test(target)
      ) {
        return match;
      }
      try {
        const resolved = new URL(target, toFileUrl(file));
        const path = relative(root, fromFileUrl(resolved)).replaceAll(
          "\\",
          "/",
        );
        return `${start}${path}${resolved.search}${resolved.hash}${end}`;
      } catch {
        return match;
      }
    },
  );
}
