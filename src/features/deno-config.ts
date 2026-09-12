/** @module Deno configuration selection and JSONC inspection. */

import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";
import type { JsonObject, JsonValue } from "../api/json.ts";
import type { DetectionContext } from "../api/repository-context.ts";
import { denoFmtConfigText, isObject } from "./deno-tasks.ts";
import { readDenoLockOwnership } from "./deno-lock-ownership.ts";

export const denoConfigPaths = ["deno.json", "deno.jsonc"] as const;
export type DenoConfigPath = typeof denoConfigPaths[number];

export type DenoConfigInspection =
  | { readonly kind: "absent" }
  | { readonly kind: "ambiguous"; readonly observation: string }
  | {
    readonly kind: "config";
    readonly path: DenoConfigPath;
    readonly text: string;
    readonly digest: string;
    readonly value: JsonObject;
    readonly exactStandalone: boolean;
  };

/** Selects the only Deno config, rejecting duplicate, invalid, or non-object input. */
export async function inspectDenoConfig(
  context: Pick<DetectionContext, "files">,
): Promise<DenoConfigInspection> {
  const observations = await Promise.all(
    denoConfigPaths.map((path) => context.files.observe(path)),
  );
  const present = observations.flatMap((observation, index) =>
    observation.kind === "absent"
      ? []
      : [{ path: denoConfigPaths[index], observation }]
  );
  if (present.length === 0) return { kind: "absent" };
  if (present.length > 1) {
    return {
      kind: "ambiguous",
      observation: "Both deno.json and deno.jsonc exist.",
    };
  }
  const item = present[0];
  if (item.observation.kind !== "file") {
    return {
      kind: "ambiguous",
      observation:
        `${item.path} is a ${item.observation.kind}, not a regular file.`,
    };
  }
  const errors: ParseError[] = [];
  const value = parse(item.observation.content, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  }) as JsonValue;
  if (errors.length > 0 || !isObject(value)) {
    return {
      kind: "ambiguous",
      observation: `${item.path} is not a valid JSON or JSONC object.`,
    };
  }
  const ownership = typeof value.lock === "boolean"
    ? await readDenoLockOwnership(context.files)
    : undefined;
  const withoutOwnedLock =
    ownership?.configPath === item.path && ownership.lock === value.lock &&
      !ownership.explicit
      ? applyEdits(
        item.observation.content,
        modify(item.observation.content, ["lock"], undefined, {}),
      )
      : undefined;
  return {
    kind: "config",
    path: item.path,
    text: item.observation.content,
    digest: item.observation.digest,
    value,
    exactStandalone: item.path === "deno.jsonc" &&
      (item.observation.content === denoFmtConfigText() ||
        withoutOwnedLock === denoFmtConfigText()),
  };
}
