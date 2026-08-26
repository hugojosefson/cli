/** @module Guarded JSON and JSONC edits that preserve document comments. */

import {
  applyEdits,
  type Edit,
  findNodeAtLocation,
  getNodeValue,
  modify,
  type Node,
  type ParseError,
  parseTree,
} from "jsonc-parser";
import type { JsonValue } from "../api/json.ts";
import { LocalFileReader } from "../repository/local-file-reader.ts";
import type { RepositoryRoot } from "../repository/repository-path.ts";
import { ChangePlanError } from "./change-plan-error.ts";
import { sameJson } from "./local-plan-state.ts";

export async function editJson(
  root: RepositoryRoot,
  url: URL,
  path: string,
  jsonPath: readonly (string | number)[],
  value: JsonValue | undefined,
  expected: JsonValue | undefined,
  remove: boolean,
): Promise<void> {
  const text = await new LocalFileReader(root.url).readText(path);
  if (text === undefined) throw new ChangePlanError("expected-state", path);
  const errors: ParseError[] = [];
  const tree = parseTree(text, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  const node = tree === undefined
    ? undefined
    : findNodeAtLocation(tree, [...jsonPath]);
  const actual = node === undefined
    ? undefined
    : getNodeValue(node) as JsonValue;
  if (errors.length > 0 || !sameJson(actual, expected)) {
    throw new ChangePlanError("expected-state", path);
  }
  const edits = remove && node !== undefined
    ? removalEdits(text, tree!, node, jsonPath)
    : modify(text, [...jsonPath], value, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    });
  await Deno.writeTextFile(url, applyEdits(text, edits));
}

function removalEdits(
  text: string,
  tree: Node,
  node: Node,
  path: readonly (string | number)[],
): Edit[] {
  const index = path.at(-1);
  if (typeof index !== "number") {
    return modify(text, [...path], undefined, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    });
  }
  const parent = findNodeAtLocation(tree, path.slice(0, -1));
  if (parent?.type !== "array") {
    return modify(text, [...path], undefined, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    });
  }
  const children = parent.children ?? [];
  const previous = children[index - 1];
  const next = children[index + 1];
  if (next !== undefined) {
    return [{
      offset: node.offset,
      length: next.offset - node.offset,
      content: "",
    }];
  }
  const start = previous === undefined
    ? node.offset
    : previous.offset + previous.length;
  const end = trailingCommaEnd(text, parent, node.offset + node.length);
  return [{ offset: start, length: end - start, content: "" }];
}

function trailingCommaEnd(text: string, parent: Node, start: number): number {
  const suffix = text.slice(start, parent.offset + parent.length - 1);
  const comma = suffix.match(/^\s*,/);
  return comma === null ? start : start + comma[0].length;
}
