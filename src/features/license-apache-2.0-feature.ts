/** @module SPDX Apache-2.0 license provider. */

import { createSpdxLicenseFeature } from "./license-spdx-feature.ts";
import {
  apacheSourceDefinition,
  createApacheTextSource,
} from "./license-apache-2.0-source.ts";
import {
  createMitTextSource,
  type LicenseTextSource,
  mitSourceDefinition,
} from "./license-mit-source.ts";

export const licenseApache20FeatureId = "license-apache-2.0";

export function createLicenseApache20Feature(
  source: LicenseTextSource = createApacheTextSource(),
  alternate: LicenseTextSource = createMitTextSource(),
) {
  return createSpdxLicenseFeature({
    id: licenseApache20FeatureId,
    definition: apacheSourceDefinition,
    text: source,
    alternates: [{
      id: "license-mit",
      definition: mitSourceDefinition,
      text: alternate,
    }],
  });
}

export const licenseApache20Feature = createLicenseApache20Feature();
