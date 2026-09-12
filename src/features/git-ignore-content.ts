/** @module Per-entry ownership and conditional generated-file exclusions. */
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";
import type { Precondition } from "../api/change-plan.ts";
import type { PlannedChange } from "../api/planned-change.ts";
import type { DetectionContext } from "../api/repository-context.ts";

const marker = "# hj:git-ignore";
const patterns = [".*.swp", "/coverage/", "/node_modules/"];

/** Only exact, recognized marker lines establish ownership. */
export function ownsGitIgnore(content: string): boolean {
  return content.split(/\r?\n/).some((line) =>
    line === marker ||
    patterns.some((pattern) => line === `${marker} ${pattern}`)
  );
}

/** Preserve custom bytes and remove only unchanged marked entries. */
export function gitIgnoreContent(
  content: string,
  desired?: readonly string[],
): string {
  const lines = content.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const kept: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.replace(/\r?\n$/, "");
    if (line === marker) {
      if (desired !== undefined) kept.push(lines[index]!);
      continue;
    }
    const pattern = patterns.find((pattern) => line === `${marker} ${pattern}`);
    if (pattern) {
      if (lines[index + 1]?.replace(/\r?\n$/, "") === pattern) {
        if (desired?.includes(pattern)) {
          kept.push(lines[index]!, lines[index + 1]!);
        }
        index++;
      }
      continue;
    }
    kept.push(lines[index]!);
  }
  let result = kept.join("");
  if (desired === undefined) return result;
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const existing = result.split(/\r?\n/);
  const additions: string[] = [];
  if (!ownsGitIgnore(result)) additions.push(marker);
  for (const pattern of desired) {
    if (!existing.includes(pattern)) {
      additions.push(`${marker} ${pattern}`, pattern);
    }
  }
  if (additions.length > 0) {
    if (result && !result.endsWith("\n")) result += newline;
    result += additions.join(newline) + newline;
  }
  return result;
}

/** Inspect the configuration after the supplied structured changes. */
export async function gitIgnoreRequirements(
  context: DetectionContext,
  changes: readonly PlannedChange[] = [],
): Promise<{ patterns: string[]; preconditions: Precondition[] }> {
  const configs = new Map<string, Record<string, unknown>>();
  const preconditions: Precondition[] = [];
  for (const path of ["deno.json", "deno.jsonc", "package.json"]) {
    const observation = await context.files.observe(path);
    if (observation.kind !== "file" && observation.kind !== "absent") {
      throw new Error(`Cannot inspect ${path}: expected a regular file.`);
    }
    preconditions.push({
      kind: "file-digest",
      path,
      digest: observation.kind === "file" ? observation.digest : undefined,
    });
    let content = observation.kind === "file" ? observation.content : undefined;
    for (const change of changes) {
      if (!("path" in change) || change.path !== path) continue;
      if (change.kind === "write-file") content = change.content;
      if (change.kind === "remove-file") content = undefined;
      if (change.kind === "set-json" || change.kind === "remove-json") {
        content = applyEdits(
          content ?? "{}",
          modify(
            content ?? "{}",
            [...change.jsonPath],
            change.kind === "set-json" ? change.value : undefined,
            {},
          ),
        );
      }
    }
    if (content === undefined) continue;
    const errors: ParseError[] = [];
    const value = parse(content, errors, {
      allowTrailingComma: true,
      disallowComments: path === "package.json",
    }) as unknown;
    if (errors.length || !isObject(value)) {
      throw new Error(
        `Cannot inspect ${path}: expected a configuration object.`,
      );
    }
    configs.set(path, value);
  }
  if (configs.has("deno.json") && configs.has("deno.jsonc")) {
    throw new Error(
      "Both deno.json and deno.jsonc exist. Select one configuration.",
    );
  }
  const deno = configs.get("deno.json") ?? configs.get("deno.jsonc");
  const pkg = configs.get("package.json");
  const desired = [".*.swp"];
  const commands = [
    ...taskCommands(deno?.tasks),
    ...taskCommands(pkg?.scripts),
  ];
  if (
    commands.some((command) =>
      /(?:^|\s)--coverage(?:=["']?(?:\.\/)?coverage\/?["']?)?(?=\s|$)/
        .test(command)
    )
  ) desired.push("/coverage/");
  if (
    deno?.nodeModulesDir === true || deno?.nodeModulesDir === "auto" ||
    deno?.nodeModulesDir === "manual" ||
    pkg && deno?.nodeModulesDir !== false && deno?.nodeModulesDir !== "none" &&
      !(isObject(pkg.installConfig) && pkg.installConfig.pnp === true)
  ) desired.push("/node_modules/");
  return { patterns: desired, preconditions };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function taskCommands(value: unknown): string[] {
  if (!isObject(value)) return [];
  return Object.values(value).flatMap((task) =>
    typeof task === "string"
      ? [task]
      : isObject(task) && typeof task.command === "string"
      ? [task.command]
      : []
  );
}
