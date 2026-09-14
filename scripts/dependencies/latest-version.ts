export function latestVersion(output: string): string {
  const parsed: unknown = JSON.parse(output);
  const version = Array.isArray(parsed) && parsed.length === 1
    ? parsed[0]
    : parsed;
  if (
    typeof version !== "string" ||
    !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)
  ) {
    throw new Error("npm did not return one version number.");
  }
  return version;
}
