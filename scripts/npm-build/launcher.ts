/** One source for npm engine metadata and native launcher compatibility checks. */
const minimumVersions = { node: [24, 0, 0], bun: [1, 4, 2] } as const;

export const nativeRuntimeEngines = Object.fromEntries(
  Object.entries(minimumVersions).map(([name, version]) => [
    name,
    `>=${version.join(".")}`,
  ]),
);

// Keep this JavaScript usable by an older runtime: it must reject that runtime
// before loading application code that can require newer syntax or APIs.
export const nativeRuntimeCheck = `(() => {
  if (process.versions.deno) return false;
  const name = process.versions.bun ? "bun" : "node";
  const match = /^(\\d+)\\.(\\d+)\\.(\\d+)(?:\\+[0-9A-Za-z.-]+)?$/.exec(process.versions[name] || "");
  if (!match) return false;
  const minimum = ${JSON.stringify(minimumVersions)}[name];
  for (let index = 0; index < 3; index++) {
    const actual = Number(match[index + 1]);
    if (actual !== minimum[index]) return actual > minimum[index];
  }
  return true;
})()`;

const runtimeError =
  `hj requires Node.js ${nativeRuntimeEngines.node} or Bun ${nativeRuntimeEngines.bun}. Install a supported runtime and add it to PATH.`;

/** A shell/JavaScript entry: explicit node/bun execution bypasses shell selection. */
export function nativeLauncherSource(): string {
  const probe = `process.exit(${
    nativeRuntimeCheck.replaceAll("\n", " ")
  } ? 0 : 1)`;
  // This line is a shell command and a JavaScript string followed by a comment.
  // exec preserves the PID, arguments, caller directory, signals and exit status.
  // Probe the real runtime identity: bunx --bun can expose Bun under `node`.
  return `#!/bin/sh
':' //; if node -e '${probe}' >/dev/null 2>&1; then exec node "$0" "$@"; fi; if bun -e '${probe}' >/dev/null 2>&1; then exec bun "$0" "$@"; fi; printf '%s\\n' '${runtimeError}' >&2; exit 127
import process from "node:process";
if (!${nativeRuntimeCheck}) {
  console.error(${JSON.stringify(runtimeError)});
  process.exit(1);
}
await import("./src/cli/cli.js");
`;
}
