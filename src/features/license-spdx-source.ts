/** @module Trusted, pinned SPDX template retrieval. */

export type LicenseTextSource = () => Promise<string>;
export type LicensePlaceholderKind = "year" | "holder" | "project";
export interface LicensePlaceholder {
  readonly kind: LicensePlaceholderKind;
  readonly marker: string;
}

export interface SpdxLicenseSourceDefinition {
  readonly name: string;
  readonly url: string;
  readonly placeholders: readonly LicensePlaceholder[];
}

/** Creates a cached source that rejects changed SPDX placeholder declarations. */
export function createSpdxTextSource(
  definition: SpdxLicenseSourceDefinition,
  fetcher: typeof fetch = fetch,
): LicenseTextSource {
  let cached: Promise<string> | undefined;
  return () => cached ??= download(definition, fetcher);
}

async function download(
  definition: SpdxLicenseSourceDefinition,
  fetcher: typeof fetch,
): Promise<string> {
  if (
    !definition.name.trim() || !definition.url.startsWith("https://") ||
    new Set(definition.placeholders.map(({ kind }) => kind)).size !==
      definition.placeholders.length ||
    definition.placeholders.some(({ marker }) =>
      !marker || /[\r\n]/.test(marker)
    )
  ) {
    throw new Error("License template definition is invalid.");
  }
  const response = await fetcher(definition.url);
  if (!response.ok) {
    throw new Error(
      `${definition.name} license download failed: ${response.status}`,
    );
  }
  const text = await response.text();
  if (
    !text.trim() ||
    definition.placeholders.some(({ marker }) => count(text, marker) !== 1) ||
    /{{\s*[^}]+\s*}}/.test(text.replaceAll(
      /{{\s*(?:year|organization|project)\s*}}/g,
      "",
    ))
  ) {
    throw new Error(
      `${definition.name} license template has invalid placeholders.`,
    );
  }
  return text;
}

function count(text: string, value: string): number {
  return text.split(value).length - 1;
}
