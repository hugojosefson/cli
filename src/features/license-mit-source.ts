/** @module Trusted MIT SPDX template retrieval. */

import {
  createSpdxTextSource,
  type LicenseTextSource,
  type SpdxLicenseSourceDefinition,
} from "./license-spdx-source.ts";

export type { LicenseTextSource } from "./license-spdx-source.ts";

export const mitSourceDefinition: SpdxLicenseSourceDefinition = {
  name: "MIT",
  url:
    "https://raw.githubusercontent.com/spdx/license-list-data/v3.28.0/text/MIT.txt",
  placeholders: [
    { kind: "year", marker: "<year>" },
    { kind: "holder", marker: "<copyright holders>" },
  ],
};
export const mitSourceUrl = mitSourceDefinition.url;

export function createMitTextSource(
  fetcher: typeof fetch = fetch,
): LicenseTextSource {
  return createSpdxTextSource(mitSourceDefinition, fetcher);
}
