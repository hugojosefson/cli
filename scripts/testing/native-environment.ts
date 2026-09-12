import { delimiter, dirname } from "node:path";
import { nativeExecutable } from "./native-tools.ts";

export async function nativeEnvironment(
  deno: string,
  searchPath: string,
): Promise<Record<string, string>> {
  const git = await nativeExecutable("git", searchPath);
  return nativeEnvironmentForTools(deno, git);
}

export function nativeEnvironmentForTools(
  deno: string,
  git: string,
): Record<string, string> {
  return {
    PATH: [...new Set([dirname(deno), dirname(git), "/usr/bin", "/bin"])].join(
      delimiter,
    ),
    LANG: "C",
    LC_ALL: "C",
    TZ: "UTC",
    NO_COLOR: "1",
    HJ_TEST_DENO: deno,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_ATTR_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    DENO_NO_UPDATE_CHECK: "1",
  };
}
