/** @module SPDX Apache-2.0 license provider. */

import { createCatalogLicenseFeature } from "./license-catalog.ts";
import type { LicenseTextSource } from "./license-spdx-source.ts";

export const licenseApache20FeatureId = "license-apache-2.0";

export function createLicenseApache20Feature(
  source?: LicenseTextSource,
  alternate?: LicenseTextSource,
) {
  return createCatalogLicenseFeature(
    licenseApache20FeatureId,
    source,
    alternate,
  );
}

export const licenseApache20Feature = createLicenseApache20Feature();
