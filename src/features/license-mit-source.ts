/** @module Trusted MIT template retrieval. */

export const mitSourceUrl =
  "https://raw.githubusercontent.com/spdx/license-list-data/v3.28.0/text/MIT.txt";

export type LicenseTextSource = () => Promise<string>;

/** Downloads and validates the pinned SPDX template once per source instance. */
export function createMitTextSource(
  fetcher: typeof fetch = fetch,
): LicenseTextSource {
  let cached: Promise<string> | undefined;
  return () => cached ??= downloadMitText(fetcher);
}

async function downloadMitText(fetcher: typeof fetch): Promise<string> {
  const response = await fetcher(mitSourceUrl);
  if (!response.ok) {
    throw new Error(`MIT license download failed: ${response.status}`);
  }
  const text = await response.text();
  if (count(text, "<year>") !== 1 || count(text, "<copyright holders>") !== 1) {
    throw new Error("MIT license template has invalid placeholders.");
  }
  return text;
}

function count(text: string, value: string): number {
  return text.split(value).length - 1;
}
