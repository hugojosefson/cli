const groups = ["github-repository", "release-core"];
const inputs = ["configuration", "packages", "dependencies", "tools"];
const durations = ["buildMs", "buildObservationMs", "observationMs"];
// Deno adds SGR codes to task prefixes. JSON data must stay unchanged.
const marker =
  // deno-lint-ignore no-control-regex
  /^(?:\x1b\[[0-9;]*m|[ \t])*(?:\[native-tests\](?:\x1b\[[0-9;]*m|[ \t])*)?Native input summary: (.*)$/;
const digest = (value: unknown): value is string =>
  typeof value === "string" && value.length === 64 &&
  /^[0-9a-f]{64}$/.test(value);
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

/** Captured process output can contain secrets. Keep only bounded observation data. */
export function nativeValidationSummary(stdout: string): string {
  const records = new Map<string, string>();
  const seen = new Set<string>();
  for (const line of stdout.split("\n")) {
    if (line.length > 4096) {
      continue;
    }
    const match = marker.exec(line);
    if (!match) {
      continue;
    }
    try {
      const record = summary(JSON.parse(match[1]));
      if (!record) {
        continue;
      }
      if (seen.has(record.runtime)) {
        records.delete(record.runtime);
        continue;
      }
      seen.add(record.runtime);
      records.set(
        record.runtime,
        `Native input summary: ${JSON.stringify(record)}\n`,
      );
    } catch {
      // Observation data cannot change release validation.
    }
  }
  return [...records.values()].join("");
}

function summary(value: unknown) {
  const data = object(value);
  if (
    !data || typeof data.runtime !== "string" ||
    !["node24", "node26", "bun"].includes(data.runtime) ||
    data.cacheEligible !== false || !digest(data.context)
  ) {
    return;
  }
  const timing = Object.fromEntries(
    durations.map((name) => [name, data[name]]),
  );
  if (
    !Object.values(timing).every((value) =>
      typeof value === "number" && Number.isFinite(value) && value >= 0
    )
  ) {
    return;
  }
  const source = object(data.groups);
  const selected: Record<
    string,
    { key: string; inputs: Record<string, string> }
  > = {};
  for (const name of groups) {
    const group = object(source?.[name]);
    const fields = object(group?.inputs);
    if (
      !digest(group?.key) || !inputs.every((name) => digest(fields?.[name]))
    ) {
      return;
    }
    selected[name] = {
      key: group.key,
      inputs: Object.fromEntries(
        inputs.map((name) => [name, fields![name] as string]),
      ),
    };
  }
  return {
    runtime: data.runtime,
    cacheEligible: false,
    context: data.context,
    groups: selected,
    ...timing,
  };
}
