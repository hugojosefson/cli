/** Exact hj version used by generated tasks and workflows. */
import metadata from "../../deno.json" with { type: "json" };

export const hjPackageReference = `jsr:${metadata.name}@${metadata.version}`;
