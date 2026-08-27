/** @module Trusted, pinned SPDX template retrieval. */

export type LicenseTextSource = () => Promise<string>;

export interface SpdxLicenseSourceDefinition {
  readonly name: string;
  readonly url: string;
  readonly placeholders: readonly [string, string];
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
  const response = await fetcher(definition.url);
  if (!response.ok) {
    throw new Error(
      `${definition.name} license download failed: ${response.status}`,
    );
  }
  const text = await response.text();
  if (
    definition.placeholders.some((placeholder) =>
      count(text, placeholder) !== 1
    )
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
