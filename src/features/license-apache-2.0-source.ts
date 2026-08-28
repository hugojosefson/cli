/** @module Trusted Apache-2.0 SPDX template retrieval. */

import {
  createSpdxTextSource,
  type LicenseTextSource,
  type SpdxLicenseSourceDefinition,
} from "./license-spdx-source.ts";

export const apacheSourceDefinition: SpdxLicenseSourceDefinition = {
  name: "Apache-2.0",
  url:
    "https://raw.githubusercontent.com/spdx/license-list-data/v3.28.0/text/Apache-2.0.txt",
  placeholders: [
    { kind: "year", marker: "[yyyy]" },
    { kind: "holder", marker: "[name of copyright owner]" },
  ],
};
export const apacheSourceUrl = apacheSourceDefinition.url;

export function createApacheTextSource(
  fetcher: typeof fetch = fetch,
): LicenseTextSource {
  return createSpdxTextSource(apacheSourceDefinition, fetcher);
}
