/** @module Shared project metadata for generated code and documentation. */

import { basename, fromFileUrl } from "@std/path";
import type { DetectionContext } from "../api/repository-context.ts";
import type { JsonObject } from "../api/json.ts";
import { isObject } from "../features/deno-tasks.ts";
import { inspectDenoConfig } from "../features/deno-config.ts";
import { LocalFileReader } from "../repository/local-file-reader.ts";

const component = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Public JSR syntax; registry permission and availability are separate checks. */
export function validPackageComponent(name: string): boolean {
  return name.length >= 2 && name.length <= 58 && component.test(name);
}

export function validScope(scope: string): boolean {
  return scope.length >= 2 && scope.length <= 20 && component.test(scope);
}

export function validJsrName(name: string): boolean {
  const match = /^@([^/]+)\/([^/]+)$/.exec(name);
  return !!match && validScope(match[1]) && validPackageComponent(match[2]);
}

export interface PackageMetadata {
  readonly name: string;
  readonly command: string;
  readonly config: JsonObject;
  readonly configured: boolean;
}

/** Uses the supplied project root, never the process working directory. */
export async function readPackageMetadata(
  context: Pick<DetectionContext, "files" | "repositoryRoot">,
): Promise<PackageMetadata> {
  const inspection = await inspectDenoConfig(context);
  if (inspection.kind === "ambiguous") throw new Error(inspection.observation);
  const config = inspection.kind === "config" ? inspection.value : {};
  const configured = config.name !== undefined;
  const name = configured
    ? config.name
    : basename(fromFileUrl(context.repositoryRoot)).toLowerCase()
      .replace(/^deno/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (
    typeof name !== "string" ||
    !(validJsrName(name) || validPackageComponent(name))
  ) {
    throw new Error(
      "Package name is invalid. Set an explicit valid name in deno.json or deno.jsonc.",
    );
  }
  const options = config.hj;
  const commandOverride = options && isObject(options)
    ? options.commandName
    : undefined;
  if (
    commandOverride !== undefined &&
    (typeof commandOverride !== "string" || !component.test(commandOverride))
  ) throw new Error("hj.commandName must be a lowercase command name.");
  return {
    name,
    command: typeof commandOverride === "string"
      ? commandOverride
      : name.split("/").at(-1)!,
    config,
    configured,
  };
}

export function projectMetadata(root: URL): Promise<PackageMetadata> {
  return readPackageMetadata({
    repositoryRoot: root,
    files: new LocalFileReader(root),
  });
}

/** Bundled data lets installed CLI help work without filesystem permissions. */
export function bundledMetadata(metadata: PackageMetadata): string {
  return JSON.stringify(
    { name: metadata.name, command: metadata.command },
    null,
    2,
  ) + "\n";
}
