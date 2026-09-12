/** @module Ownership of separately editable installation and example sources. */
import { isObject } from "../features/deno-tasks.ts";
import type { PlannedReadmeFiles } from "./planned-readme-files.ts";

export const guideStatePath = ".hj/readme.json";
export const installPath = "readme/install.sh";
export const examplePath = "readme/example-usage.ts";
export const exampleExport = "./readme/example-usage.ts";
export interface GuideState {
  version: 1;
  files: Record<string, string>;
  exampleExport?: boolean;
}
export async function readGuideState(
  files: PlannedReadmeFiles,
): Promise<GuideState> {
  const text = await files.read(guideStatePath);
  if (text === undefined) return { version: 1, files: {} };
  const value = JSON.parse(text);
  if (
    !isObject(value) || value.version !== 1 || !isObject(value.files) ||
    Object.entries(value.files).some(([key, text]) =>
      ![installPath, examplePath].includes(key) || typeof text !== "string"
    ) ||
    value.exampleExport !== undefined &&
      typeof value.exampleExport !== "boolean"
  ) throw new Error("Unrecognized README contribution ownership file.");
  return value as unknown as GuideState;
}
/** Custom files retain their content and public export, including on disable. */
export async function manageGuideFile(
  files: PlannedReadmeFiles,
  state: GuideState,
  path: string,
  desired: string | undefined,
): Promise<string | undefined> {
  const current = await files.read(path);
  const previous = state.files[path];
  if (current !== undefined && current !== previous) return current;
  if (desired !== undefined) {
    await files.write(path, desired);
    state.files[path] = desired;
    return desired;
  }
  if (previous !== undefined) {
    await files.write(path, undefined);
    delete state.files[path];
  }
  return undefined;
}
