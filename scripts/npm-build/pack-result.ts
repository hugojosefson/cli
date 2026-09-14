export function packResult(
  output: string,
  expected: { name: string; version: string },
): { filename: string; integrity: string; [key: string]: unknown } {
  const parsed = JSON.parse(output);
  const entries = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object"
    ? Object.values(parsed)
    : [];
  const result = entries.length === 1 ? entries[0] : undefined;
  if (
    !result || result.name !== expected.name ||
    result.version !== expected.version ||
    typeof result.filename !== "string" ||
    !/^[\w.-]+\.tgz$/.test(result.filename) ||
    typeof result.integrity !== "string" ||
    !result.integrity.startsWith("sha512-")
  ) {
    throw new Error("npm returned invalid archive metadata.");
  }
  return result;
}
