import { fileURLToPath } from "node:url";
import { focusedGroups, focusedTests } from "./observation.ts";

export function nativeCommandPlan(
  runtime: string,
  files: string[],
  root: URL,
  filter?: string,
): { args: string[]; focused: boolean }[] {
  const selection = runtime === "bun" ? files.map((file) => [file]) : [
    ...focusedGroups.map((group) =>
      files.filter((file) => group.files.includes(file))
    ),
    files.filter((file) => !focusedTests.includes(file)),
  ];
  return selection.filter((group) => group.length).map((group) => ({
    focused: group.every((file) => focusedTests.includes(file)),
    args: [
      ...(runtime === "bun"
        ? ["test", "--timeout=120000"]
        : ["--test", "--test-concurrency=1", "--test-timeout=120000"]),
      ...(filter ? ["--test-name-pattern", filter] : []),
      ...group.map((file) =>
        fileURLToPath(new URL(file.replace(/\.ts$/, ".js"), root))
      ),
    ],
  }));
}
