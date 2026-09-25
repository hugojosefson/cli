/** @module Scoped JSONC preparation for local overwrite plans. */
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";
import {
  validCommandName,
  validJsrName,
  validPackageComponent,
} from "../package/metadata.ts";
import { isObject } from "../features/deno-tasks.ts";
import { parseSemver } from "../release/semver.ts";
import { denoConfigPaths } from "../repository/read-deno-config.ts";
import type { OverwriteFiles } from "./overwrite-files.ts";

export async function prepareOverwriteConfig(
  files: OverwriteFiles,
  ids: readonly string[],
  keys: readonly (readonly string[])[],
): Promise<void> {
  const observations = await Promise.all(
    denoConfigPaths.map((path) => files.observe(path)),
  );
  const chosen = observations.findIndex((item) => item.kind === "file");
  const index = chosen < 0 ? 1 : chosen;
  const path = denoConfigPaths[index];
  for (const other of denoConfigPaths.filter((name) => name !== path)) {
    if (await files.exists(other)) await files.remove(other);
  }
  const original = observations[index];
  const errors: ParseError[] = [];
  const value = original.kind === "file"
    ? parse(original.content, errors, { allowTrailingComma: true })
    : {};
  let content =
    original.kind === "file" && errors.length === 0 && isObject(value)
      ? original.content
      : "{}\n";
  const set = (key: readonly string[], value: unknown) => {
    content = applyEdits(
      content,
      modify(content, [...key], value, {
        formattingOptions: { insertSpaces: true, tabSize: 2 },
      }),
    );
  };
  for (const key of keys) {
    const current = parse(content);
    if (
      key.length > 1 && current[key[0]] !== undefined &&
      !isObject(current[key[0]])
    ) {
      set(
        [key[0]],
        key[0] === "exports" && typeof current.exports === "string"
          ? { ".": current.exports }
          : {},
      );
    }
    const exists = key.reduce(
      (value, part) =>
        value && typeof value === "object" ? value[part] : undefined,
      parse(content),
    );
    if (exists !== undefined) set(key, undefined);
  }
  const current = parse(content);
  if (ids.includes("deno-fmt")) {
    if (current.fmt !== undefined && !isObject(current.fmt)) set(["fmt"], {});
    else if (
      current.fmt?.exclude !== undefined &&
      (!Array.isArray(current.fmt.exclude) ||
        current.fmt.exclude.some((item: unknown) => typeof item !== "string"))
    ) set(["fmt", "exclude"], undefined);
  }
  if (
    (ids.includes("deno-config-version") || ids.includes("jsr-package")) &&
    (typeof current.version !== "string" || !parseSemver(current.version))
  ) set(["version"], "0.0.0");
  if (
    ids.includes("jsr-package") && current.name !== undefined &&
    (typeof current.name !== "string" ||
      !validJsrName(current.name))
  ) set(["name"], undefined);
  if (ids.includes("deno-cli")) {
    if (
      current.name !== undefined &&
      (typeof current.name !== "string" ||
        !(validJsrName(current.name) || validPackageComponent(current.name)))
    ) set(["name"], undefined);
    const command = current.hj?.commandName;
    if (
      command !== undefined &&
      (typeof command !== "string" || !validCommandName(command))
    ) set(["hj", "commandName"], undefined);
  }
  await files.write(
    path,
    content,
    original.kind === "file" ? original.mode | 0o200 : 0o644,
  );
}

/** Keep the formatter away from generated read-only output. */
export async function excludeOverwriteReadme(
  files: OverwriteFiles,
): Promise<void> {
  for (const path of denoConfigPaths) {
    const file = await files.observe(path);
    if (file.kind !== "file") continue;
    const config = parse(file.content);
    const previous = Array.isArray(config.fmt?.exclude)
      ? config.fmt.exclude
      : [];
    if (previous.includes("README.md")) return;
    const content = applyEdits(
      file.content,
      modify(file.content, ["fmt", "exclude"], [...previous, "README.md"], {
        formattingOptions: { insertSpaces: true, tabSize: 2 },
      }),
    );
    await files.write(path, content, file.mode);
  }
}
