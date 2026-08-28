/** @module SPDX MIT license provider. */

import { createCatalogLicenseFeature } from "./license-catalog.ts";
import type { LicenseTextSource } from "./license-spdx-source.ts";

export const licenseMitFeatureId = "license-mit";

export function createLicenseMitFeature(
  source?: LicenseTextSource,
  alternate?: LicenseTextSource,
) {
  return createCatalogLicenseFeature(licenseMitFeatureId, source, alternate);
}

export const licenseMitFeature = createLicenseMitFeature();
