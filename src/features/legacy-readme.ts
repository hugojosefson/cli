/** @module Recognition and previews for the git-hj-init README migration. */

import { fileDifference } from "./detection-differences.ts";
import { readmeBuildError } from "./readme-build-error.ts";
import type { ArtifactObservation } from "../api/artifact-inspection.ts";
import type { DetectionContext } from "../api/repository-context.ts";
import { buildReadmeText } from "../readme/build-readme.ts";
import { digestBytes } from "../repository/digest-bytes.ts";

export const legacyReadmeTask =
  "touch README.md && chmod +w README.md && ./readme/generate-readme.ts readme/README.md > README.md && deno fmt README.md; chmod -w README.md";
export const legacyDefaultTask =
  "deno fmt && deno lint --fix && (deno check & deno task test) && deno task readme";
export const legacyAllTask = "deno task default && deno publish --dry-run";

export type LegacyReadme =
  | { readonly kind: "absent" }
  | { readonly kind: "conflict"; readonly reason: string }
  | {
    readonly kind: "recognized";
    readonly source: string;
    readonly output: string;
  };

/** Exact legacy commands can be replaced; arbitrary generator tasks cannot. */
export function isLegacyReadmeTask(value: unknown): boolean {
  return typeof value === "string" && value.trim() === legacyReadmeTask;
}

/** Recognizes the known generator without executing project-local code. */
export async function inspectLegacyReadme(
  context: DetectionContext,
  task: unknown,
  source: ArtifactObservation,
): Promise<LegacyReadme> {
  if (!isLegacyReadmeTask(task)) return { kind: "absent" };
  if (source.kind !== "file") {
    return conflict(fileDifference("readme/README.md", source));
  }
  const generator = await context.files.observe("readme/generate-readme.ts");
  if (generator.kind !== "file") {
    return conflict(fileDifference("readme/generate-readme.ts", generator));
  }
  if (!await knownGenerator(generator.content)) {
    return conflict(
      "readme/generate-readme.ts: expected the unmodified git-hj-init generator template. Found a different source digest.",
    );
  }
  const converted = convertLegacyIncludes(source.content);
  if (converted === undefined) {
    return conflict(
      `readme/README.md: expected quoted includes for ./install.sh or ./example-usage.ts. Found an unsupported quoted include at line ${
        source.content.split("\n").findIndex((line) =>
          /^\s*["']@@include\(/.test(line) &&
          !/^\s*"@@include\(\.\/(install\.sh|example-usage\.ts)\)";\s*$/.test(
            line,
          )
        ) + 1
      }.`,
    );
  }
  try {
    return {
      kind: "recognized",
      source: converted,
      output: await buildReadmeText(context.repositoryRoot, converted),
    };
  } catch (error) {
    return conflict(readmeBuildError(error, context.repositoryRoot));
  }
}

/** Convert only the two include forms emitted by the supported initializer. */
export function convertLegacyIncludes(source: string): string | undefined {
  const converted = source.replaceAll(
    /^([ \t]*)"@@include\(\.\/(install\.sh|example-usage\.ts)\)";[ \t]*(\r?)$/gm,
    "$1@@include(./$2)$3",
  );
  return /^\s*["']@@include\(/m.test(converted) ? undefined : converted;
}

async function knownGenerator(source: string): Promise<boolean> {
  // Package names were interpolated by git-hj-init. Everything else must match
  // the formatted template; edited generators retain their existing behavior.
  const normalized = source.replaceAll("\r\n", "\n").replaceAll(
    /@[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9_-]*/g,
    (name) => name === "@std/path" ? name : "@SCOPE/PACKAGE",
  );
  return await digestBytes(new TextEncoder().encode(normalized)) ===
    "32d01bdc9cae69e451b87884f6a3c4482574389b8270d199b9eda50fe35ac018";
}

function conflict(reason: string): LegacyReadme {
  return { kind: "conflict", reason };
}
