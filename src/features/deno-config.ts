/** @module Feature-specific classification of inspected Deno configuration. */
import { applyEdits, modify } from "jsonc-parser";
import type { DetectionContext } from "../api/repository-context.ts";
import {
  type DenoConfigRead,
  readDenoConfig,
} from "../repository/read-deno-config.ts";
import { denoFmtConfigText } from "./deno-tasks.ts";
import { readDenoLockOwnership } from "./deno-lock-ownership.ts";
export {
  type DenoConfigPath,
  denoConfigPaths,
} from "../repository/read-deno-config.ts";
export type DenoConfigInspection =
  | Exclude<DenoConfigRead, { kind: "config" }>
  | (Extract<DenoConfigRead, { kind: "config" }> & {
    readonly exactStandalone: boolean;
  });

export async function inspectDenoConfig(
  context: Pick<DetectionContext, "files">,
): Promise<DenoConfigInspection> {
  const config = await readDenoConfig(context);
  if (config.kind !== "config") return config;
  const ownership = typeof config.value.lock === "boolean"
    ? await readDenoLockOwnership(context.files)
    : undefined;
  const withoutOwnedLock = ownership?.configPath === config.path &&
      ownership.lock === config.value.lock &&
      !ownership.explicit
    ? applyEdits(
      config.text,
      modify(config.text, ["lock"], undefined, {}),
    )
    : undefined;
  return {
    ...config,
    exactStandalone: config.path === "deno.jsonc" &&
      (config.text === denoFmtConfigText() ||
        withoutOwnedLock === denoFmtConfigText()),
  };
}
