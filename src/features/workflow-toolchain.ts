/** Tested Deno version for newly generated workflows. */
import toolchain from "../../toolchain.json" with { type: "json" };

export const workflowDenoVersion = toolchain.deno;
