/** @module Expected and observed values for feature inspection. */

import type {
  ArtifactObservation,
  ExactArtifactInspection,
} from "../api/artifact-inspection.ts";

export function valueType(value: unknown): string {
  return value === undefined
    ? "missing"
    : value === null
    ? "null"
    : Array.isArray(value)
    ? "array"
    : typeof value;
}

export function valueDifference(
  path: string,
  key: string,
  expected: string,
  value: unknown,
): string {
  const actual =
    typeof value === "boolean" || typeof value === "number" || value === null
      ? JSON.stringify(value)
      : valueType(value);
  return `${path} ${key}: expected ${expected}. Found ${actual}.`;
}

export function fileDifference(
  path: string,
  file: ArtifactObservation,
): string {
  return `${path}: expected a readable regular file. Found ${
    file.kind === "unreadable"
      ? "an unreadable path"
      : file.kind === "absent"
      ? "no file"
      : file.kind === "file"
      ? "a regular file"
      : `a ${file.kind}`
  }.`;
}

export function artifactDifference(
  inspection: ExactArtifactInspection,
  marker?: string,
): string {
  if (inspection.result === "absent") {
    return fileDifference(inspection.schema.path, { kind: "absent" });
  }
  if (inspection.result === "unreadable") {
    return `${inspection.schema.path}: expected a readable regular file. Found an unreadable path.`;
  }
  const file = inspection.observation;
  if (file.kind !== "file") {
    return fileDifference(inspection.schema.path, file);
  }
  if (marker && !file.content.startsWith(marker)) {
    return `${inspection.schema.path}: expected the prefix ${
      JSON.stringify(marker.trimEnd())
    }. Found a file without that prefix.`;
  }
  if (inspection.schema.kind !== "file") {
    return `${inspection.schema.path}: expected ${inspection.schema.kind}. Found a regular file.`;
  }
  const expected = inspection.schema.content.split("\n");
  const actual = file.content.split("\n");
  const index = expected.findIndex((line, index) => line !== actual[index]);
  if (index < 0 && expected.length === actual.length) {
    return `${inspection.schema.path}: expected mode ${
      inspection.schema.mode.toString(8)
    }. Found mode ${file.mode.toString(8)}.`;
  }
  const line = index < 0 ? expected.length : index;
  const expectedLine = expected[line] ?? "";
  const actualLine = actual[line] ?? "";
  const column = [...actualLine].findIndex((character, index) =>
    character !== expectedLine[index]
  );
  const action =
    /^\s*-?\s*uses:\s*([A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+@(?:v[0-9][A-Za-z0-9_.-]*|[0-9a-f]{40}))(?:\s+#.*)?$/
      .exec(actualLine)?.[1];
  const field = /^\s*(?:-\s*)?[A-Za-z_][A-Za-z0-9_-]*:\s*$/.test(actualLine);
  const found = field
    ? JSON.stringify(actualLine)
    : action
    ? `uses: ${JSON.stringify(action)}`
    : column < 0
    ? `a line ending after column ${actualLine.length}`
    : `character ${JSON.stringify(actualLine[column])} at column ${column + 1}`;
  return `${inspection.schema.path}:${line + 1}: expected ${
    JSON.stringify(expected[line] ?? "(end of file)")
  }. Found ${
    actual[line] === undefined
      ? "end of file"
      : actual[line] === ""
      ? "a blank line"
      : found
  }.`;
}

export function versionDifference(path: string, value: unknown): string {
  const found =
    typeof value === "string" && /^[v^~<>= .*x\d+-]{1,80}$/.test(value)
      ? JSON.stringify(value)
      : valueType(value);
  return `${path} version: expected an exact SemVer string such as "1.2.3". Found ${found}.`;
}

export function modulePathDifference(path: string, value: unknown): string {
  const reason = typeof value !== "string"
    ? valueType(value)
    : !value.startsWith("./")
    ? "a string without the required ./ prefix"
    : value.includes("\\")
    ? "a backslash in the module path"
    : value.includes("\0")
    ? "a NUL character in the module path"
    : value.includes(":")
    ? "a colon in the module path"
    : "an empty, . or .. path segment";
  return `${path} exports["./cli"]: expected a relative path below the repository root, beginning with ./ and without traversal segments. Found ${reason}.`;
}

export function packageNameDifference(path: string, value: unknown): string {
  const actual = typeof value === "string"
    ? /^[a-z][a-z0-9-]{0,30}$/.test(value)
      ? JSON.stringify(value)
      : !value.startsWith("@")
      ? "a name without the @scope/ prefix"
      : value.split("/").length !== 2
      ? "a name without one slash between scope and package"
      : "a scope or package component with unsupported characters or length"
    : valueType(value);
  return `${path} name: expected a scoped JSR name with the form @scope/package. Found ${actual}.`;
}
