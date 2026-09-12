/** @module Deno configuration selection without generated task dependencies. */
import { parse, type ParseError, printParseErrorCode } from "jsonc-parser";
import type { JsonObject, JsonValue } from "../api/json.ts";
import type { DetectionContext } from "../api/repository-context.ts";

export const denoConfigPaths = ["deno.json", "deno.jsonc"] as const;
export type DenoConfigPath = typeof denoConfigPaths[number];
export type DenoConfigRead =
  | { readonly kind: "absent" }
  | { readonly kind: "ambiguous"; readonly observation: string }
  | {
    readonly kind: "config";
    readonly path: DenoConfigPath;
    readonly text: string;
    readonly digest: string;
    readonly value: JsonObject;
  };

/** Reads the sole JSON or JSONC object and preserves its original bytes. */
export async function readDenoConfig(
  context: Pick<DetectionContext, "files">,
): Promise<DenoConfigRead> {
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
      observation:
        "Both deno.json and deno.jsonc exist. Expected one Deno configuration file. Found two.",
    };
  }
  const item = present[0];
  if (item.observation.kind !== "file") {
    return {
      kind: "ambiguous",
      observation:
        `${item.path}: expected a readable regular file. Found ${item.observation.kind}.`,
    };
  }
  const errors: ParseError[] = [];
  const value = parse(item.observation.content, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  }) as JsonValue;
  if (
    errors.length > 0 ||
    !isObject(value)
  ) {
    return {
      kind: "ambiguous",
      observation: `${item.path}: expected a JSON or JSONC object. Found ${
        errors.length
          ? `${printParseErrorCode(errors[0].error)} at line ${
            item.observation.content.slice(0, errors[0].offset).split("\n")
              .length
          }, offset ${errors[0].offset}`
          : Array.isArray(value)
          ? "an array"
          : value === null
          ? "null"
          : typeof value
      }.`,
    };
  }
  return {
    kind: "config",
    path: item.path,
    text: item.observation.content,
    digest: item.observation.digest,
    value,
  };
}

function isObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
