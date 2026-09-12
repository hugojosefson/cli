/** @module Item-level changes to generated JSON, YAML, and text files. */
import { parse as parseJson, type ParseError } from "jsonc-parser";
import { parseDocument } from "yaml";
import type { JsonValue } from "../api/json.ts";
import {
  describeConfiguration,
  safeRepairText,
} from "./repair-configuration-description.ts";

function structured(path: string, text: string): JsonValue | undefined {
  if (/\.jsonc?$/.test(path)) {
    const errors: ParseError[] = [];
    const value = parseJson(text, errors);
    return errors.length ? undefined : value;
  }
  if (/\.ya?ml$/.test(path)) {
    const document = parseDocument(text);
    return document.errors.length ? undefined : document.toJSON();
  }
  return undefined;
}

/** Names changed keys or exact text additions, removals and moves. */
export function describeFileRepair(
  path: string,
  before: string | undefined,
  after: string,
): string[] {
  const value = structured(path, after);
  const expected = before === undefined ? undefined : structured(path, before);
  let valuesPreserved = false;
  if (value !== undefined && (before === undefined || expected !== undefined)) {
    const changes = describeConfiguration(value, expected);
    if (changes.length) {
      return changes.map((change) => `Update ${path}: ${change}.`);
    }
    valuesPreserved = true;
  }
  const lines = (text: string) => text.split(/\r?\n/);
  const oldLines = lines(before ?? "");
  const newLines = lines(after);
  // Pair equal lines by occurrence. Never print unchanged or moved user content.
  const positions = new Map<string, number[]>();
  oldLines.forEach((line, index) => {
    const occurrences = positions.get(line) ?? [];
    occurrences.push(index);
    positions.set(line, occurrences);
  });
  const matched = newLines.map((line) => positions.get(line)?.shift());
  const actions: string[] = valuesPreserved
    ? [`Preserve all configuration values in ${path}.`]
    : [];
  const removals = [...positions.values()].flat().sort((a, b) => a - b);
  for (const index of removals) {
    actions.push(`Remove ${path} line ${index + 1} (existing content).`);
  }
  // Describe final order without pretending that a line moved to its own index.
  const order = matched.filter((index): index is number => index !== undefined);
  const sorted = [...order].sort((a, b) => a - b);
  let first = 0;
  let last = order.length;
  while (first < last && order[first] === sorted[first]) first++;
  while (last > first && order[last - 1] === sorted[last - 1]) last--;
  if (first < last) {
    actions.push(
      `Reorder retained ${path} lines: original lines ${
        order.slice(first, last).map((index) => index + 1).join(", ")
      } must appear in that order.`,
    );
  }
  newLines.forEach((line, index) => {
    const oldIndex = matched[index];
    if (oldIndex === undefined) {
      actions.push(
        `Add ${path} line ${index + 1}: ${
          valuesPreserved
            ? "formatted configuration or comments; configuration values stay unchanged."
            : safeRepairText(line) || "(blank line)"
        }`,
      );
    }
  });
  return actions.length
    ? actions
    : [`Normalize line endings in ${path}; preserve all lines.`];
}
