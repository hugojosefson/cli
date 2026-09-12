/** @module Field differences for inspected GitHub ruleset definitions. */

export function jsonDifferences(
  expected: unknown,
  actual: unknown,
  path: string,
): string[] {
  if (JSON.stringify(expected) === JSON.stringify(actual)) return [];
  if (isObject(expected) && isObject(actual)) {
    return [...new Set([...Object.keys(expected), ...Object.keys(actual)])]
      .flatMap((key) =>
        jsonDifferences(expected[key], actual[key], `${path}.${key}`)
      );
  }
  return [
    `${path}: expected ${JSON.stringify(expected) ?? "no value"}. Found ${
      JSON.stringify(actual) ?? "no value"
    }.`,
  ];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
